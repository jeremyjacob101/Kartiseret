import Foundation

enum TicketQRPayload {
    private static let alphabet = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:".utf8)

    /// QR descriptors hold packed codewords, including segment headers and padding.
    /// Decode supported segments before comparing against Vision's UTF-8 text.
    static func validatedText(_ text: String?, codewords: Data, version: Int) -> String? {
        guard let text, !text.isEmpty, !text.utf8.contains(0),
              (1...40).contains(version) else { return nil }
        var reader = Bits(bytes: Array(codewords))
        let sizeGroup = version < 10 ? 0 : version < 27 ? 1 : 2
        var decoded: [UInt8] = []

        while reader.remaining >= 4 {
            guard let mode = reader.read(4) else { return nil }
            if mode == 0 { break }
            switch mode {
            case 1, 2, 4:
                let countBits = switch mode {
                case 1: [10, 12, 14][sizeGroup]
                case 2: [9, 11, 13][sizeGroup]
                default: [8, 16, 16][sizeGroup]
                }
                guard let count = reader.read(countBits),
                      count <= text.utf8.count - decoded.count else { return nil }
                if mode == 4 {
                    for _ in 0..<count {
                        guard let byte = reader.read(8) else { return nil }
                        decoded.append(UInt8(byte))
                    }
                } else {
                    guard readCompact(mode: mode, count: count, reader: &reader, into: &decoded) else {
                        return nil
                    }
                }
            case 7:
                // These standard ECI assignments fit in one byte. The final
                // exact-byte comparison still rejects lossy text conversions.
                guard let assignment = reader.read(8), [3, 26, 27].contains(assignment) else { return nil }
            default:
                // Structured append, FNC1, Kanji, and other modes need their own
                // handling before their contents can be reproduced safely.
                return nil
            }
        }
        if reader.remaining < 4, reader.read(reader.remaining) != 0 { return nil }
        return decoded.elementsEqual(text.utf8) ? text : nil
    }

    private static func readCompact(mode: Int, count: Int, reader: inout Bits, into output: inout [UInt8]) -> Bool {
        let groupSize = mode == 1 ? 3 : 2
        let radix = mode == 1 ? 10 : 45
        let widths = mode == 1 ? [0, 4, 7, 10] : [0, 6, 11]
        var remaining = count
        while remaining > 0 {
            let size = min(groupSize, remaining)
            guard var value = reader.read(widths[size]) else { return false }
            let start = output.count
            for _ in 0..<size {
                output.append(alphabet[value % radix])
                value /= radix
            }
            guard value == 0 else { return false }
            output[start...].reverse()
            remaining -= size
        }
        return true
    }

    private struct Bits {
        let bytes: [UInt8]
        private var offset = 0
        var remaining: Int { bytes.count * 8 - offset }

        init(bytes: [UInt8]) { self.bytes = bytes }

        mutating func read(_ width: Int) -> Int? {
            guard width <= remaining else { return nil }
            var result = 0
            for _ in 0..<width {
                result = (result << 1) | Int((bytes[offset / 8] >> (7 - offset % 8)) & 1)
                offset += 1
            }
            return result
        }
    }
}
