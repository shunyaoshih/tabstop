// Regenerates the extension icons in icons/, since Chrome doesn't take SVG:
//   swift scripts/generate-icons.swift
import CoreGraphics
import Foundation
import ImageIO

let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ hex: Int) -> CGColor {
    let parts = [hex >> 16, hex >> 8, hex].map { CGFloat($0 & 255) / 255 }
    return CGColor(colorSpace: srgb, components: parts + [1])!
}

// The Tab key's arrow-to-a-bar, with the bar swapped for a bookmark ribbon.
// Drawn on a 96-unit tile with y pointing down.
func drawMark(_ ctx: CGContext) {
    ctx.setFillColor(color(0x1a1b26))
    ctx.addPath(CGPath(roundedRect: CGRect(x: 0, y: 0, width: 96, height: 96),
                       cornerWidth: 22, cornerHeight: 22, transform: nil))
    ctx.fillPath()

    let arrow = CGMutablePath()
    arrow.move(to: CGPoint(x: 14, y: 48))
    arrow.addLine(to: CGPoint(x: 50, y: 48))
    arrow.move(to: CGPoint(x: 36, y: 31))
    arrow.addLine(to: CGPoint(x: 53, y: 48))
    arrow.addLine(to: CGPoint(x: 36, y: 65))
    ctx.setStrokeColor(color(0xc0caf5))
    ctx.setLineWidth(9)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.addPath(arrow)
    ctx.strokePath()

    let ribbon = CGMutablePath()
    ribbon.move(to: CGPoint(x: 73, y: 16))
    ribbon.addArc(tangent1End: CGPoint(x: 84, y: 16), tangent2End: CGPoint(x: 84, y: 81), radius: 4)
    ribbon.addArc(tangent1End: CGPoint(x: 84, y: 81), tangent2End: CGPoint(x: 73, y: 72), radius: 1.6)
    ribbon.addLine(to: CGPoint(x: 73, y: 72))
    ribbon.addArc(tangent1End: CGPoint(x: 62, y: 81), tangent2End: CGPoint(x: 62, y: 16), radius: 1.6)
    ribbon.addArc(tangent1End: CGPoint(x: 62, y: 16), tangent2End: CGPoint(x: 73, y: 16), radius: 4)
    ribbon.closeSubpath()
    ctx.setFillColor(color(0x7aa2f7))
    ctx.addPath(ribbon)
    ctx.fillPath()
}

try FileManager.default.createDirectory(atPath: "icons", withIntermediateDirectories: true)

// Chrome recommends 96 units of art inside the 128 icon's transparent padding.
for (size, art) in [(16, 16), (32, 32), (48, 48), (128, 96)] {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let inset = CGFloat(size - art) / 2
    ctx.translateBy(x: inset, y: CGFloat(size) - inset)
    ctx.scaleBy(x: CGFloat(art) / 96, y: -CGFloat(art) / 96)
    drawMark(ctx)
    let url = URL(fileURLWithPath: "icons/icon-\(size).png") as CFURL
    let file = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(file, ctx.makeImage()!, nil)
    CGImageDestinationFinalize(file)
}
