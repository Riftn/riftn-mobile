import Foundation
import UniformTypeIdentifiers

public enum SharedVideoImport {
  static let changed = Notification.Name("RiftnSharedVideoImportChanged")

  private static let copyQueue = DispatchQueue(label: "io.dehub.mobile.shared-video-import")
  private static let lock = NSLock()
  private static var failed = false
  private static let files = FileManager.default
  private static let root = files.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("SharedVideos", isDirectory: true)
  private static let inbox = root.appendingPathComponent("Inbox", isDirectory: true)
  private static let attachments = root.appendingPathComponent("Attachments", isDirectory: true)

  /// Copies a video selected in Files or another app before releasing its security scope.
  public static func receive(_ source: URL) {
    let scoped = source.startAccessingSecurityScopedResource()
    copyQueue.async {
      defer {
        if scoped { source.stopAccessingSecurityScopedResource() }
        DispatchQueue.main.async { NotificationCenter.default.post(name: changed, object: nil) }
      }
      do {
        try copyIntoInbox(source)
      } catch {
        lock.lock()
        failed = true
        lock.unlock()
      }
    }
  }

  private static func copyIntoInbox(_ source: URL) throws {
    let id = "\(Date().timeIntervalSince1970)-\(UUID().uuidString)"
    let staging = root.appendingPathComponent(id, isDirectory: true)
    try files.createDirectory(at: staging, withIntermediateDirectories: true)
    defer { try? files.removeItem(at: staging) }

    var coordinationError: NSError?
    var copyError: Error?
    NSFileCoordinator().coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinationError) { url in
      do {
        let properties = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .contentTypeKey])
        let type = [properties.contentType, UTType(filenameExtension: url.pathExtension)]
          .compactMap { $0 }
          .first { $0.conforms(to: .movie) || $0.conforms(to: .video) }
        guard properties.isRegularFile == true, properties.isSymbolicLink != true, let type else {
          throw CocoaError(.fileReadUnsupportedScheme)
        }
        let filename = url.pathExtension.isEmpty
          ? "video.\(type.preferredFilenameExtension ?? "mov")" : url.lastPathComponent
        try files.copyItem(at: url, to: staging.appendingPathComponent(filename))
      } catch {
        copyError = error
      }
    }
    if let coordinationError { throw coordinationError }
    if let copyError { throw copyError }

    try files.createDirectory(at: inbox, withIntermediateDirectories: true)
    // Publish the completed file in one move so JS never sees a partial import.
    try files.moveItem(at: staging, to: inbox.appendingPathComponent(id, isDirectory: true))
  }

  static func take() -> [String: String]? {
    lock.lock()
    defer { lock.unlock() }
    if failed {
      failed = false
      return ["kind": "error"]
    }
    guard let next = (try? files.contentsOfDirectory(atPath: inbox.path))?.sorted().first else { return nil }
    let pending = inbox.appendingPathComponent(next, isDirectory: true)
    guard let filename = (try? files.contentsOfDirectory(atPath: pending.path))?.first else { return nil }

    do {
      try files.createDirectory(at: attachments, withIntermediateDirectories: true)
      let claimed = attachments.appendingPathComponent(next, isDirectory: true)
      try files.moveItem(at: pending, to: claimed)
      let file = claimed.appendingPathComponent(filename)
      var result = ["kind": "video", "id": next, "uri": file.absoluteString, "fileName": filename]
      result["mimeType"] = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType
      return result
    } catch {
      return ["kind": "error"]
    }
  }

  static func discard(_ id: String) {
    guard id.range(of: #"^\d+\.\d+-[A-F0-9-]{36}$"#, options: .regularExpression) != nil else { return }
    copyQueue.async { try? files.removeItem(at: attachments.appendingPathComponent(id, isDirectory: true)) }
  }
}
