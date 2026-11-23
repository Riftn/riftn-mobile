import Foundation

/**
 * The slice of AMF0 an RTMP publisher needs: write the connect, createStream,
 * publish and metadata messages, and read the server's _result / onStatus
 * answers well enough to find a transaction id, a stream id and a status code.
 */
enum Amf0 {
  static func number(_ value: Double) -> Data {
    var data = Data([0x00])
    var bits = value.bitPattern.bigEndian
    withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
    return data
  }

  static func bool(_ value: Bool) -> Data { Data([0x01, value ? 1 : 0]) }

  static func string(_ value: String) -> Data {
    var data = Data([0x02])
    data.append(shortString(value))
    return data
  }

  static let null = Data([0x05])

  static func object(_ pairs: [(String, Data)]) -> Data {
    var data = Data([0x03])
    for (key, value) in pairs { data.append(shortString(key)); data.append(value) }
    data.append(contentsOf: [0x00, 0x00, 0x09])
    return data
  }

  static func ecmaArray(_ pairs: [(String, Data)]) -> Data {
    var data = Data([0x08])
    var count = UInt32(pairs.count).bigEndian
    withUnsafeBytes(of: &count) { data.append(contentsOf: $0) }
    for (key, value) in pairs { data.append(shortString(key)); data.append(value) }
    data.append(contentsOf: [0x00, 0x00, 0x09])
    return data
  }

  private static func shortString(_ value: String) -> Data {
    let bytes = Array(value.utf8.prefix(0xFFFF))
    var data = Data([UInt8(bytes.count >> 8), UInt8(bytes.count & 0xFF)])
    data.append(contentsOf: bytes)
    return data
  }

  /// Decodes every value in a command message. Unknown markers stop the read;
  /// what was read before them is still returned.
  static func decode(_ data: Data) -> [Any] {
    var reader = Reader(bytes: [UInt8](data))
    var values: [Any] = []
    while reader.remaining > 0, let value = reader.value() { values.append(value) }
    return values
  }

  private struct Reader {
    let bytes: [UInt8]
    var at = 0
    var remaining: Int { bytes.count - at }

    mutating func take(_ count: Int) -> ArraySlice<UInt8>? {
      guard count >= 0, remaining >= count else { return nil }
      defer { at += count }
      return bytes[at..<(at + count)]
    }

    mutating func u16() -> Int? {
      guard let b = take(2) else { return nil }
      return Int(b[b.startIndex]) << 8 | Int(b[b.startIndex + 1])
    }

    mutating func u32() -> Int? {
      guard let b = take(4) else { return nil }
      return b.reduce(0) { $0 << 8 | Int($1) }
    }

    mutating func shortString() -> String? {
      guard let length = u16(), let b = take(length) else { return nil }
      return String(decoding: b, as: UTF8.self)
    }

    mutating func properties() -> [String: Any]? {
      var result: [String: Any] = [:]
      while true {
        guard let key = shortString() else { return nil }
        if key.isEmpty, remaining > 0, bytes[at] == 0x09 { at += 1; return result }
        guard let value = value() else { return nil }
        result[key] = value
      }
    }

    mutating func value() -> Any? {
      guard let marker = take(1)?.first else { return nil }
      switch marker {
      case 0x00:
        guard let b = take(8) else { return nil }
        let bits = b.reduce(UInt64(0)) { $0 << 8 | UInt64($1) }
        return Double(bitPattern: bits)
      case 0x01:
        guard let b = take(1) else { return nil }
        return b.first != 0
      case 0x02:
        return shortString()
      case 0x03:
        return properties()
      case 0x05, 0x06:
        return NSNull()
      case 0x08:
        guard u32() != nil else { return nil }
        return properties()
      case 0x0A:
        guard let count = u32() else { return nil }
        var list: [Any] = []
        for _ in 0..<count { guard let item = value() else { return nil }; list.append(item) }
        return list
      case 0x0C:
        guard let length = u32(), let b = take(length) else { return nil }
        return String(decoding: b, as: UTF8.self)
      default:
        return nil
      }
    }
  }
}
