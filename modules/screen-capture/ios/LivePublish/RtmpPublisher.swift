import Foundation
import Network

/**
 * A minimal RTMP publisher: handshake, connect, createStream, publish, then
 * FLV-shaped audio, video and metadata messages. It is what OBS speaks, so the
 * ingest treats this exactly like any encoder (MediaMTX's `{playbackId}-rtmp`
 * path with the key in the query, or Livepeer's `rtmp://…/live/{key}`).
 *
 * The URL is split the way OBS splits it: everything after the last slash is
 * the stream name (query included) and anything between the host and it is
 * the app. `rtmp://host/abc-rtmp?user=u&pass=p` connects to app "" and
 * publishes "abc-rtmp?user=u&pass=p"; `rtmp://host/live/key` connects to app
 * "live" and publishes "key".
 *
 * All calls are made on `queue`.
 */
final class RtmpPublisher {
  enum Failure: Error, Equatable {
    case badURL
    /// The server said no to this stream (wrong key, stream ended, already live elsewhere).
    case refused(String)
    /// The network dropped or never connected.
    case network(String)
  }

  struct Endpoint: Equatable {
    let host: String
    let port: UInt16
    let app: String
    let streamName: String
    let tcUrl: String

    init?(url: String) {
      guard url.hasPrefix("rtmp://") else { return nil }
      let rest = url.dropFirst("rtmp://".count)
      guard let slash = rest.firstIndex(of: "/") else { return nil }
      let authority = String(rest[rest.startIndex..<slash])
      let pathAndQuery = String(rest[rest.index(after: slash)...])
      let queryStart = pathAndQuery.firstIndex(of: "?") ?? pathAndQuery.endIndex
      let path = pathAndQuery[pathAndQuery.startIndex..<queryStart]
      let query = pathAndQuery[queryStart...]
      if let lastSlash = path.lastIndex(of: "/") {
        app = String(path[path.startIndex..<lastSlash])
        streamName = String(path[path.index(after: lastSlash)...]) + query
      } else {
        app = ""
        streamName = String(path) + query
      }
      guard !streamName.isEmpty, !authority.isEmpty else { return nil }
      if let colon = authority.lastIndex(of: ":"), let parsed = UInt16(authority[authority.index(after: colon)...]) {
        host = String(authority[authority.startIndex..<colon]); port = parsed
      } else {
        host = authority; port = 1935
      }
      tcUrl = "rtmp://\(authority)" + (app.isEmpty ? "" : "/\(app)")
    }
  }

  private enum Phase { case idle, handshake, connecting, creatingStream, publishing, live, closed }

  let queue: DispatchQueue
  private let endpoint: Endpoint
  private var connection: NWConnection?
  private var phase: Phase = .idle
  private var inbox = [UInt8]()
  private var inboxStart = 0
  private var handshakeSent = false
  private var c2Sent = false
  private var outChunkSize = 4096
  private var inChunkSize = 128
  private var windowAckSize = 2_500_000
  private var received = 0
  private var lastAcked = 0
  private var streamId: UInt32 = 1
  private var publishTimer: DispatchWorkItem?
  private struct InboundChunk { var timestamp: UInt32 = 0; var length = 0; var type: UInt8 = 0; var streamId: UInt32 = 0; var extended = false; var payload = [UInt8]() }
  private var inbound: [Int: InboundChunk] = [:]

  /// Bytes handed to the socket and not yet written out.
  private(set) var pendingBytes = 0
  var onLive: (() -> Void)?
  var onClosed: ((Failure?) -> Void)?

  init?(url: String, queue: DispatchQueue) {
    guard let endpoint = Endpoint(url: url) else { return nil }
    self.endpoint = endpoint
    self.queue = queue
  }

  var isLive: Bool { phase == .live }

  func start() {
    guard phase == .idle, let port = NWEndpoint.Port(rawValue: endpoint.port) else { return }
    phase = .handshake
    let tcp = NWProtocolTCP.Options()
    tcp.noDelay = true
    tcp.connectionTimeout = 10
    let parameters = NWParameters(tls: nil, tcp: tcp)
    let connection = NWConnection(host: NWEndpoint.Host(endpoint.host), port: port, using: parameters)
    self.connection = connection
    connection.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .ready: self.sendHandshake(); self.receive()
      case .failed(let error): self.close(.network(error.localizedDescription))
      case .waiting(let error): self.close(.network(error.localizedDescription))
      case .cancelled: self.close(nil)
      default: break
      }
    }
    connection.start(queue: queue)
  }

  /// Closes the connection. `failure` nil means "we chose to stop".
  func close(_ failure: Failure? = nil) {
    guard phase != .closed else { return }
    let wasOpen = phase != .idle
    phase = .closed
    publishTimer?.cancel(); publishTimer = nil
    if wasOpen, failure == nil, let connection, connection.state == .ready {
      // Tell the server the broadcast ended on purpose rather than dropping it.
      sendCommand(["deleteStream"], transaction: 0, extra: [Amf0.null, Amf0.number(Double(streamId))])
    }
    connection?.stateUpdateHandler = nil
    connection?.cancel()
    connection = nil
    onClosed?(failure)
    onClosed = nil
    onLive = nil
  }

  // MARK: Media

  func sendMetadata(width: Int, height: Int, fps: Int, videoKbps: Int, audioKbps: Int) {
    guard phase == .live else { return }
    var body = Amf0.string("@setDataFrame")
    body.append(Amf0.string("onMetaData"))
    body.append(Amf0.ecmaArray([
      ("width", Amf0.number(Double(width))),
      ("height", Amf0.number(Double(height))),
      ("framerate", Amf0.number(Double(fps))),
      ("videocodecid", Amf0.number(7)),
      ("videodatarate", Amf0.number(Double(videoKbps))),
      ("audiocodecid", Amf0.number(10)),
      ("audiodatarate", Amf0.number(Double(audioKbps))),
      ("audiosamplerate", Amf0.number(48000)),
      ("audiosamplesize", Amf0.number(16)),
      ("audiochannels", Amf0.number(2)),
      ("stereo", Amf0.bool(true)),
      ("encoder", Amf0.string("Riftn")),
    ]))
    writeMessage(csid: 5, type: 18, streamId: streamId, timestamp: 0, payload: body)
  }

  func sendVideo(_ payload: Data, timestamp: UInt32) {
    guard phase == .live else { return }
    writeMessage(csid: 6, type: 9, streamId: streamId, timestamp: timestamp, payload: payload)
  }

  func sendAudio(_ payload: Data, timestamp: UInt32) {
    guard phase == .live else { return }
    writeMessage(csid: 4, type: 8, streamId: streamId, timestamp: timestamp, payload: payload)
  }

  // MARK: Handshake

  private func sendHandshake() {
    guard !handshakeSent else { return }
    handshakeSent = true
    var c0c1 = [UInt8](repeating: 0, count: 1 + 1536)
    c0c1[0] = 0x03
    // C1: 4 bytes time (0), 4 bytes zero, 1528 random bytes.
    for i in 9..<c0c1.count { c0c1[i] = UInt8.random(in: 0...255) }
    send(Data(c0c1))
  }

  private func receive() {
    connection?.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
      guard let self, self.phase != .closed else { return }
      if let data, !data.isEmpty {
        self.received += data.count
        self.inbox.append(contentsOf: data)
        self.process()
      }
      if let error { self.close(.network(error.localizedDescription)); return }
      if complete { self.close(.network("closed by server")); return }
      if self.phase != .closed { self.receive() }
    }
  }

  private var available: Int { inbox.count - inboxStart }

  private func consume(_ count: Int) -> ArraySlice<UInt8> {
    let slice = inbox[inboxStart..<(inboxStart + count)]
    inboxStart += count
    return slice
  }

  private func compactInbox() {
    if inboxStart > 0, inboxStart == inbox.count { inbox.removeAll(keepingCapacity: true); inboxStart = 0 }
    else if inboxStart > 65536 { inbox.removeFirst(inboxStart); inboxStart = 0 }
  }

  private func process() {
    defer { compactInbox() }
    if phase == .handshake {
      if !c2Sent {
        guard available >= 1 + 1536 else { return }
        _ = consume(1)
        let s1 = consume(1536)
        send(Data(s1))  // C2 echoes S1
        c2Sent = true
      }
      guard available >= 1536 else { return }
      _ = consume(1536)  // S2
      phase = .connecting
      sendSetChunkSize(outChunkSize)
      sendCommand(["connect"], transaction: 1, extra: [Amf0.object([
        ("app", Amf0.string(endpoint.app)),
        ("type", Amf0.string("nonprivate")),
        ("flashVer", Amf0.string("FMLE/3.0 (compatible; FMSc/1.0)")),
        ("tcUrl", Amf0.string(endpoint.tcUrl)),
      ])])
    }
    while phase != .closed, readChunk() {}
    if received - lastAcked >= windowAckSize {
      lastAcked = received
      writeMessage(csid: 2, type: 3, streamId: 0, timestamp: 0, payload: be32(UInt32(truncatingIfNeeded: received)))
    }
  }

  /// Reads one chunk; false when more bytes are needed.
  private func readChunk() -> Bool {
    guard available >= 1 else { return false }
    let first = inbox[inboxStart]
    let format = Int(first >> 6)
    var csid = Int(first & 0x3F)
    var headerLength = 1
    if csid == 0 {
      guard available >= 2 else { return false }
      csid = 64 + Int(inbox[inboxStart + 1]); headerLength = 2
    } else if csid == 1 {
      guard available >= 3 else { return false }
      csid = 64 + Int(inbox[inboxStart + 1]) + Int(inbox[inboxStart + 2]) * 256; headerLength = 3
    }
    let messageHeaderLength = [11, 7, 3, 0][format]
    guard available >= headerLength + messageHeaderLength else { return false }
    var state = inbound[csid] ?? InboundChunk()
    let h = inboxStart + headerLength
    var timestampField: UInt32 = 0
    if format <= 2 {
      timestampField = UInt32(inbox[h]) << 16 | UInt32(inbox[h + 1]) << 8 | UInt32(inbox[h + 2])
    }
    if format <= 1 {
      state.length = Int(inbox[h + 3]) << 16 | Int(inbox[h + 4]) << 8 | Int(inbox[h + 5])
      state.type = inbox[h + 6]
    }
    if format == 0 {
      state.streamId = UInt32(inbox[h + 7]) | UInt32(inbox[h + 8]) << 8 | UInt32(inbox[h + 9]) << 16 | UInt32(inbox[h + 10]) << 24
    }
    var extendedLength = 0
    if format <= 2 { state.extended = timestampField == 0xFFFFFF }
    if state.extended { extendedLength = 4 }
    let fullHeader = headerLength + messageHeaderLength + extendedLength
    guard available >= fullHeader else { return false }
    if state.payload.isEmpty && state.length > 0 {
      state.timestamp = state.extended ? 0 : timestampField
    }
    let remainingInMessage = max(0, state.length - state.payload.count)
    let chunkLength = min(inChunkSize, remainingInMessage)
    guard available >= fullHeader + chunkLength else { return false }
    _ = consume(fullHeader)
    state.payload.append(contentsOf: consume(chunkLength))
    if state.payload.count >= state.length {
      let message = state.payload
      state.payload = []
      inbound[csid] = state
      handle(type: state.type, payload: message)
    } else {
      inbound[csid] = state
    }
    return true
  }

  private func handle(type: UInt8, payload: [UInt8]) {
    switch type {
    case 1:  // Set Chunk Size
      if payload.count >= 4 {
        let size = Int(UInt32(payload[0] & 0x7F) << 24 | UInt32(payload[1]) << 16 | UInt32(payload[2]) << 8 | UInt32(payload[3]))
        if size > 0 { inChunkSize = size }
      }
    case 5:  // Window Acknowledgement Size
      if payload.count >= 4 {
        let size = Int(UInt32(payload[0]) << 24 | UInt32(payload[1]) << 16 | UInt32(payload[2]) << 8 | UInt32(payload[3]))
        if size > 0 { windowAckSize = size }
      }
    case 4:  // User Control: answer pings
      if payload.count >= 6, payload[0] == 0, payload[1] == 6 {
        var pong = Data([0, 7]); pong.append(contentsOf: payload[2..<6])
        writeMessage(csid: 2, type: 4, streamId: 0, timestamp: 0, payload: pong)
      }
    case 20:
      handleCommand(Amf0.decode(Data(payload)))
    default:
      break
    }
  }

  private func handleCommand(_ values: [Any]) {
    guard let name = values.first as? String else { return }
    let transaction = values.count > 1 ? (values[1] as? Double ?? 0) : 0
    switch name {
    case "_result":
      if transaction == 1, phase == .connecting {
        phase = .creatingStream
        sendCommand(["releaseStream"], transaction: 2, extra: [Amf0.null, Amf0.string(endpoint.streamName)])
        sendCommand(["FCPublish"], transaction: 3, extra: [Amf0.null, Amf0.string(endpoint.streamName)])
        sendCommand(["createStream"], transaction: 4, extra: [Amf0.null])
      } else if transaction == 4, phase == .creatingStream {
        if values.count > 3, let id = values[3] as? Double { streamId = UInt32(id) }
        phase = .publishing
        sendCommand(["publish"], transaction: 5, extra: [Amf0.null, Amf0.string(endpoint.streamName), Amf0.string("live")], streamId: streamId)
        // Some servers never confirm; give them a moment, then start sending.
        let fallback = DispatchWorkItem { [weak self] in self?.becomeLive() }
        publishTimer = fallback
        queue.asyncAfter(deadline: .now() + 4, execute: fallback)
      }
    case "_error":
      if phase == .connecting || phase == .creatingStream || phase == .publishing {
        close(.refused(statusCode(values) ?? "rejected"))
      }
    case "onStatus":
      let code = statusCode(values) ?? ""
      if code == "NetStream.Publish.Start" { becomeLive() }
      else if code.contains("BadName") || code.contains("Failed") || code.contains("Rejected") || code.contains("Denied") {
        close(.refused(code))
      }
    default:
      break
    }
  }

  private func statusCode(_ values: [Any]) -> String? {
    for value in values.dropFirst(2) {
      if let info = value as? [String: Any], let code = info["code"] as? String { return code }
    }
    return nil
  }

  private func becomeLive() {
    publishTimer?.cancel(); publishTimer = nil
    guard phase == .publishing else { return }
    phase = .live
    onLive?()
  }

  // MARK: Writing

  private func sendSetChunkSize(_ size: Int) {
    writeMessage(csid: 2, type: 1, streamId: 0, timestamp: 0, payload: be32(UInt32(size)))
  }

  private func sendCommand(_ name: [String], transaction: Double, extra: [Data], streamId: UInt32 = 0) {
    var body = Data()
    for part in name { body.append(Amf0.string(part)) }
    body.append(Amf0.number(transaction))
    for item in extra { body.append(item) }
    writeMessage(csid: 3, type: 20, streamId: streamId, timestamp: 0, payload: body)
  }

  private func be32(_ value: UInt32) -> Data {
    Data([UInt8(value >> 24), UInt8((value >> 16) & 0xFF), UInt8((value >> 8) & 0xFF), UInt8(value & 0xFF)])
  }

  /// Writes one message as chunks, always with a full (type 0) header so
  /// every message carries its own absolute timestamp.
  private func writeMessage(csid: UInt8, type: UInt8, streamId: UInt32, timestamp: UInt32, payload: Data) {
    let extended = timestamp >= 0xFFFFFF
    let stamp = extended ? 0xFFFFFF : timestamp
    var out = Data(capacity: payload.count + 16 + payload.count / outChunkSize * 5)
    out.append(csid & 0x3F)
    out.append(contentsOf: [UInt8((stamp >> 16) & 0xFF), UInt8((stamp >> 8) & 0xFF), UInt8(stamp & 0xFF)])
    let length = payload.count
    out.append(contentsOf: [UInt8((length >> 16) & 0xFF), UInt8((length >> 8) & 0xFF), UInt8(length & 0xFF)])
    out.append(type)
    out.append(contentsOf: [UInt8(streamId & 0xFF), UInt8((streamId >> 8) & 0xFF), UInt8((streamId >> 16) & 0xFF), UInt8((streamId >> 24) & 0xFF)])
    if extended { out.append(be32(timestamp)) }
    var offset = 0
    payload.withUnsafeBytes { raw in
      guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return }
      while offset < length {
        if offset > 0 {
          out.append(0xC0 | (csid & 0x3F))
          if extended { out.append(be32(timestamp)) }
        }
        let count = min(outChunkSize, length - offset)
        out.append(base + offset, count: count)
        offset += count
      }
    }
    send(out)
  }

  private func send(_ data: Data) {
    guard let connection else { return }
    pendingBytes += data.count
    connection.send(content: data, completion: .contentProcessed { [weak self] error in
      guard let self else { return }
      self.pendingBytes -= data.count
      if let error, self.phase != .closed { self.close(.network(error.localizedDescription)) }
    })
  }
}
