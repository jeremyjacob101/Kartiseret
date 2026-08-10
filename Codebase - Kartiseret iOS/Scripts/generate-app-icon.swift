import AppKit

guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: generate-app-icon.swift source-logo.png output-directory")
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
guard let source = NSImage(contentsOf: sourceURL) else { fatalError("Unable to load source mark") }

func color(_ hex: UInt32) -> NSColor {
    let red = CGFloat((hex >> 16) & 0xff) / 255
    let green = CGFloat((hex >> 8) & 0xff) / 255
    let blue = CGFloat(hex & 0xff) / 255
    return NSColor(
        srgbRed: red,
        green: green,
        blue: blue,
        alpha: 1
    )
}

func render(_ filename: String, background: NSColor, markColor: NSColor) throws {
    let size = NSSize(width: 1_024, height: 1_024)
    let mark = NSImage(size: size)
    mark.lockFocus()
    NSGraphicsContext.current?.imageInterpolation = .high
    let available = NSRect(x: 118, y: 165, width: 788, height: 694)
    let aspect = source.size.width / source.size.height
    var rect = available
    if rect.width / rect.height > aspect {
        rect.size.width = rect.height * aspect
        rect.origin.x = (size.width - rect.width) / 2
    } else {
        rect.size.height = rect.width / aspect
        rect.origin.y = (size.height - rect.height) / 2
    }
    source.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
    markColor.setFill()
    NSRect(origin: .zero, size: size).fill(using: .sourceIn)
    mark.unlockFocus()

    let final = NSImage(size: size)
    final.lockFocus()
    background.setFill()
    NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
    mark.draw(in: NSRect(origin: .zero, size: size))
    final.unlockFocus()

    guard let tiff = final.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else {
        fatalError("Unable to encode icon")
    }
    try png.write(to: outputDirectory.appendingPathComponent(filename), options: .atomic)
}

try render("AppIcon-1024.png", background: color(0x212121), markColor: color(0xa66ae3))
try render("AppIcon-1024-dark.png", background: color(0x151515), markColor: color(0xb77bee))
try render("AppIcon-1024-tinted.png", background: color(0x161616), markColor: color(0xffffff))
