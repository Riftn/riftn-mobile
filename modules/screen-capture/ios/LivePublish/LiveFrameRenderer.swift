import CoreImage
import CoreVideo
import Foundation
import ImageIO

/**
 * Turns a screen frame into a stream frame: upright (ReplayKit hands landscape
 * frames over sideways with an orientation tag), scaled to stream size, and
 * centred on black when the picture's shape does not match the canvas (the
 * moments between the phone turning and the stream following it).
 */
final class LiveFrameRenderer {
  /// The longest side a stream frame gets. 1280 keeps a phone screen sharp at
  /// a bitrate a phone uplink can hold.
  static let longSide = 1280
  static let shortSideCap = 720

  private let context = CIContext(options: [.cacheIntermediates: false])
  private var pool: CVPixelBufferPool?
  private(set) var canvas: (width: Int, height: Int) = (0, 0)
  private let black = CIImage(color: CIColor(red: 0, green: 0, blue: 0))

  /// The canvas a picture of this (upright) size gets: same shape, long side
  /// at most 1280, short side at most 720, both even.
  static func canvasSize(width: Int, height: Int) -> (width: Int, height: Int) {
    guard width > 0, height > 0 else { return (720, 1280) }
    let long = Double(max(width, height)), short = Double(min(width, height))
    var scale = min(1, Double(longSide) / long)
    scale = min(scale, Double(shortSideCap) / short)
    let even = { (value: Double) -> Int in max(2, Int((value / 2).rounded()) * 2) }
    return (even(Double(width) * scale), even(Double(height) * scale))
  }

  /// Upright size of a frame with this orientation.
  static func uprightSize(width: Int, height: Int, orientation: CGImagePropertyOrientation) -> (width: Int, height: Int) {
    switch orientation {
    case .left, .right, .leftMirrored, .rightMirrored: return (height, width)
    default: return (width, height)
    }
  }

  func setCanvas(width: Int, height: Int) {
    guard canvas.width != width || canvas.height != height else { return }
    canvas = (width, height)
    let attributes: [CFString: Any] = [
      kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
      kCVPixelBufferWidthKey: width,
      kCVPixelBufferHeightKey: height,
      kCVPixelBufferIOSurfacePropertiesKey: [:] as [CFString: Any],
    ]
    var created: CVPixelBufferPool?
    CVPixelBufferPoolCreate(kCFAllocatorDefault, [kCVPixelBufferPoolMinimumBufferCountKey: 3] as CFDictionary, attributes as CFDictionary, &created)
    pool = created
  }

  func render(_ source: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> CVPixelBuffer? {
    guard let pool, canvas.width > 0 else { return nil }
    var target: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &target) == kCVReturnSuccess, let target else { return nil }
    var image = CIImage(cvPixelBuffer: source).oriented(orientation)
    image = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
    let width = CGFloat(canvas.width), height = CGFloat(canvas.height)
    let scale = min(width / image.extent.width, height / image.extent.height)
    image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    let x = ((width - image.extent.width) / 2).rounded(), y = ((height - image.extent.height) / 2).rounded()
    image = image.transformed(by: CGAffineTransform(translationX: x, y: y))
    let bounds = CGRect(x: 0, y: 0, width: width, height: height)
    context.render(image.composited(over: black).cropped(to: bounds), to: target, bounds: bounds, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
    return target
  }
}
