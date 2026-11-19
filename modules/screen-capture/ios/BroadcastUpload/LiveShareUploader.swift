import CoreImage
import ImageIO
import QuartzCore
import CoreMedia
import Foundation
import ReplayKit

/**
 * Screen share while live: the broadcast was started from the system picker
 * on the live screen, so instead of recording to a file the frames go to the
 * app over a Unix socket in the shared app group. react-native-webrtc's
 * ScreenCapturer listens on that socket (`rtc_SSFD`, RTCAppGroupIdentifier in
 * the app's Info.plist) and turns each frame into the live video track.
 *
 * Wire format is what that capturer reads: one HTTP-style message per frame,
 * with Content-Length, Buffer-Width, Buffer-Height and Buffer-Orientation
 * headers and a JPEG body.
 */
final class LiveShareSocket: NSObject, StreamDelegate {
  private let path: String
  private var socket: Int32 = -1
  private var input: InputStream?
  private var output: OutputStream?
  private let thread: Thread
  private var opened = false
  var onSpace: (() -> Void)?
  var onClosed: (() -> Void)?

  init?(appGroup: String) {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
    path = container.appendingPathComponent("rtc_SSFD").path
    thread = Thread { RunLoop.current.add(Port(), forMode: .default); while !Thread.current.isCancelled { RunLoop.current.run(until: .distantFuture) } }
    super.init()
    thread.name = "io.riftn.live-share"
    thread.start()
  }

  /// Connects to the app; false when the app is not listening (no live share in progress).
  func open() -> Bool {
    socket = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard socket >= 0 else { return false }
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard path.utf8.count < capacity else { Darwin.close(socket); return false }
    _ = withUnsafeMutablePointer(to: &address.sun_path) { pointer in
      pointer.withMemoryRebound(to: CChar.self, capacity: capacity) { strncpy($0, path, capacity - 1) }
    }
    let connected = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.connect(socket, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard connected == 0 else { Darwin.close(socket); socket = -1; return false }
    var read: Unmanaged<CFReadStream>?
    var write: Unmanaged<CFWriteStream>?
    CFStreamCreatePairWithSocket(kCFAllocatorDefault, socket, &read, &write)
    input = read?.takeRetainedValue()
    output = write?.takeRetainedValue()
    guard let input, let output else { return false }
    input.setProperty(kCFBooleanTrue, forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String))
    output.setProperty(kCFBooleanTrue, forKey: Stream.PropertyKey(kCFStreamPropertyShouldCloseNativeSocket as String))
    input.delegate = self; output.delegate = self
    perform(#selector(schedule), on: thread, with: nil, waitUntilDone: true)
    opened = true
    return true
  }

  @objc private func schedule() {
    input?.schedule(in: .current, forMode: .default)
    output?.schedule(in: .current, forMode: .default)
    input?.open(); output?.open()
  }

  @objc private func unschedule() {
    input?.remove(from: .current, forMode: .default)
    output?.remove(from: .current, forMode: .default)
  }

  func close() {
    guard opened else { return }
    opened = false
    perform(#selector(unschedule), on: thread, with: nil, waitUntilDone: true)
    input?.close(); output?.close()
    input = nil; output = nil
    thread.cancel()
  }

  /// Writes as much as the socket takes; returns bytes written, or -1.
  func write(_ pointer: UnsafePointer<UInt8>, _ length: Int) -> Int {
    guard let output, output.hasSpaceAvailable else { return 0 }
    return output.write(pointer, maxLength: length)
  }

  func stream(_ stream: Stream, handle event: Stream.Event) {
    switch event {
    case .hasSpaceAvailable: if stream === output { onSpace?() }
    case .endEncountered, .errorOccurred: onClosed?()
    default: break
    }
  }
}

final class LiveShareUploader {
  private static let appGroup = "group.io.dehub.mobile.screen-capture"
  private let socket: LiveShareSocket
  private let context = CIContext(options: [.useSoftwareRenderer: false])
  private let queue = DispatchQueue(label: "io.riftn.live-share.upload", qos: .userInteractive)
  private var pending: Data?
  private var offset = 0
  private var lastFrame: CFTimeInterval = 0
  var onClosed: (() -> Void)?

  /// Nil when the app is not waiting for a live screen share.
  init?() {
    guard let socket = LiveShareSocket(appGroup: LiveShareUploader.appGroup) else { return nil }
    self.socket = socket
    guard socket.open() else { socket.close(); return nil }
    socket.onSpace = { [weak self] in self?.queue.async { self?.flush() } }
    socket.onClosed = { [weak self] in self?.onClosed?() }
  }

  func send(_ sampleBuffer: CMSampleBuffer) {
    // 15 fps keeps the extension well inside its 50 MB memory ceiling.
    let now = CACurrentMediaTime()
    guard now - lastFrame >= 1.0 / 15.0 else { return }
    guard let image = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let orientation = (CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber)?.uint32Value ?? 1
    queue.async {
      guard self.pending == nil else { return }  // still writing the previous frame
      self.lastFrame = now
      guard let message = self.frame(image, orientation: orientation) else { return }
      self.pending = message; self.offset = 0
      self.flush()
    }
  }

  func close() { socket.close() }

  private func frame(_ buffer: CVPixelBuffer, orientation: UInt32) -> Data? {
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
    // Half size: a phone screen at full resolution is far more than a live
    // stream carries, and it halves the encode work per frame.
    let scale: CGFloat = 0.5
    let image = CIImage(cvPixelBuffer: buffer).transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
      let jpeg = context.jpegRepresentation(of: image, colorSpace: space,
        options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.7]) else { return nil }
    let message = CFHTTPMessageCreateResponse(nil, 200, nil, kCFHTTPVersion1_1).takeRetainedValue()
    CFHTTPMessageSetHeaderFieldValue(message, "Content-Length" as CFString, String(jpeg.count) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Width" as CFString, String(Int(CGFloat(width) * scale)) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Height" as CFString, String(Int(CGFloat(height) * scale)) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Orientation" as CFString, String(orientation) as CFString)
    CFHTTPMessageSetBody(message, jpeg as CFData)
    return CFHTTPMessageCopySerializedMessage(message)?.takeRetainedValue() as Data?
  }

  private func flush() {
    guard let data = pending else { return }
    let written = data.withUnsafeBytes { raw -> Int in
      guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return -1 }
      return socket.write(base + offset, data.count - offset)
    }
    if written < 0 { pending = nil; return }
    offset += written
    if offset >= data.count { pending = nil; offset = 0 }
  }
}
