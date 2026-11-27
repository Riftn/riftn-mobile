import Foundation
import UniformTypeIdentifiers

enum SharedPhotoImport {
  private static let files = FileManager.default
  private static let maxBytes = 42_069_000
  private static var inbox: URL? {
    files.containerURL(forSecurityApplicationGroupIdentifier: "group.io.dehub.mobile.screen-capture")?
      .appendingPathComponent("SharedPhotoInbox", isDirectory: true)
  }

  // The extension gets a temporary file that expires when its provider callback returns.
  static func enqueue(_ source: URL, type: UTType) throws {
    guard let inbox, let ext = type.preferredFilenameExtension else {
      throw CocoaError(.fileWriteUnknown)
    }
    let properties = try source.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
    guard properties.isRegularFile == true,
      let size = properties.fileSize, size > 0, size <= maxBytes else {
      throw CocoaError(.fileReadTooLarge)
    }
    try files.createDirectory(at: inbox, withIntermediateDirectories: true)
    let name = "\(Int64(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString).\(ext)"
    let staging = inbox.appendingPathComponent(".\(name)")
    defer { try? files.removeItem(at: staging) }
    try files.copyItem(at: source, to: staging)
    try files.moveItem(at: staging, to: inbox.appendingPathComponent(name))
  }

  static func take() -> [String: String]? {
    guard let inbox,
      let pending = (try? files.contentsOfDirectory(at: inbox, includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]))?.min(by: { $0.lastPathComponent < $1.lastPathComponent })
    else { return nil }
    let attachments = files.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("SharedPhotos", isDirectory: true)
    do {
      try files.createDirectory(at: attachments, withIntermediateDirectories: true)
      let file = attachments.appendingPathComponent(pending.lastPathComponent)
      try files.moveItem(at: pending, to: file)
      var result = ["kind": "photo", "id": file.deletingPathExtension().lastPathComponent, "uri": file.absoluteString]
      result["mimeType"] = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType
      return result
    } catch {
      return ["kind": "error"]
    }
  }
}
