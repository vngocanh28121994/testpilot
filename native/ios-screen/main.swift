// TestPilot Screen Capture — quay màn hình iPhone cắm qua USB, gửi về runner.
//
// Vì sao có chương trình này: luồng hình iOS cũ là MJPEG của WebDriverAgent —
// tối đa ~19 khung/giây, ảnh thu nhỏ còn 30%, và mỗi khung là một lần XCTest
// chụp màn hình NGAY TRÊN điện thoại, tranh CPU với chính những cú chạm người
// dùng đang gửi. macOS có sẵn một đường khác: iPhone cắm USB hiện ra như một
// nguồn video (QuickTime › Bản ghi phim mới dùng đúng đường này), ~40 khung/giây
// ở độ phân giải gốc, không đụng tới WDA.
//
// Vì sao là một .app chứ không phải một lệnh: macOS coi nguồn ấy là CAMERA, và
// chỉ hỏi quyền camera cho chương trình có `NSCameraUsageDescription` — một lệnh
// trần bị từ chối im lặng. Là .app thì nó có danh tính riêng trong Cài đặt ›
// Quyền riêng tư › Camera, tách khỏi tiến trình máy chủ.
//
// Giao thức với runner (TCP 127.0.0.1, runner mở cổng, chương trình này nối vào):
//   ra:  [1 byte loại][4 byte độ dài, big-endian][dữ liệu]
//        'i' JSON thông tin (kích thước khung), 'h' H.264 Annex-B,
//        'j' một ảnh JPEG, 'e' câu lỗi (UTF-8) rồi thoát.
//   vào: từng dòng — "h264 1|0", "jpeg 1|0", "key" (xin khung khoá).
// Runner đóng kết nối là chương trình thoát: không bao giờ sống mồ côi.

import AVFoundation
import CoreImage
import CoreMediaIO
import Foundation
import Network
import VideoToolbox

// MARK: - Tham số

struct Options {
  var port: UInt16 = 0
  var name = ""
  /// Cạnh dài tối đa của luồng H.264 (điểm ảnh).
  var h264Long = 1560
  /// Cạnh dài tối đa của ảnh JPEG.
  var jpegLong = 1170
  var fps = 30
  var bitrate = 3_000_000
  var jpegQuality = 0.5
}

func parseOptions() -> Options {
  var o = Options()
  var args = CommandLine.arguments.dropFirst().makeIterator()
  while let key = args.next() {
    guard let value = args.next() else { break }
    switch key {
    case "--port": o.port = UInt16(value) ?? 0
    case "--name": o.name = value
    case "--h264-long": o.h264Long = Int(value) ?? o.h264Long
    case "--jpeg-long": o.jpegLong = Int(value) ?? o.jpegLong
    case "--fps": o.fps = Int(value) ?? o.fps
    case "--bitrate": o.bitrate = Int(value) ?? o.bitrate
    case "--jpeg-quality": o.jpegQuality = Double(value) ?? o.jpegQuality
    default: break
    }
  }
  return o
}

let options = parseOptions()
if options.port == 0 {
  FileHandle.standardError.write("Thiếu --port.\n".data(using: .utf8)!)
  exit(64)
}

// MARK: - Kết nối về runner

let link = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: options.port)!, using: .tcp)
let linkQueue = DispatchQueue(label: "link")
/// Số byte đã giao cho `send` mà chưa gửi xong — để bỏ khung khi runner nhận không kịp.
var inFlight = 0
let inFlightLock = NSLock()

func packet(_ kind: Character, _ payload: Data) {
  var header = Data([UInt8(kind.asciiValue!)])
  var length = UInt32(payload.count).bigEndian
  header.append(Data(bytes: &length, count: 4))
  inFlightLock.lock(); inFlight += header.count + payload.count; inFlightLock.unlock()
  link.send(content: header + payload, completion: .contentProcessed { _ in
    inFlightLock.lock(); inFlight -= header.count + payload.count; inFlightLock.unlock()
  })
}

func backlogged() -> Bool {
  inFlightLock.lock(); defer { inFlightLock.unlock() }
  return inFlight > 4 * 1024 * 1024
}

func fail(_ message: String, code: Int32) -> Never {
  packet("e", message.data(using: .utf8)!)
  // Cho gói lỗi kịp đi trước khi thoát.
  Thread.sleep(forTimeInterval: 0.3)
  exit(code)
}

let connected = DispatchSemaphore(value: 0)
link.stateUpdateHandler = { state in
  switch state {
  case .ready: connected.signal()
  case .failed, .cancelled: exit(0)
  default: break
  }
}
link.start(queue: linkQueue)
if connected.wait(timeout: .now() + 10) == .timedOut {
  FileHandle.standardError.write("Không nối được về runner ở cổng \(options.port).\n".data(using: .utf8)!)
  exit(65)
}

// MARK: - Lệnh từ runner

var wantH264 = false
var wantJpeg = false
var wantKey = true
let stateLock = NSLock()

func readCommands() {
  link.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, done, error in
    if let data, let text = String(data: data, encoding: .utf8) {
      stateLock.lock()
      for line in text.split(separator: "\n") {
        let parts = line.split(separator: " ")
        switch (parts.first.map(String.init), parts.dropFirst().first.map(String.init)) {
        case ("h264", "1"): wantH264 = true; wantKey = true
        case ("h264", "0"): wantH264 = false
        case ("jpeg", "1"): wantJpeg = true
        case ("jpeg", "0"): wantJpeg = false
        case ("key", _): wantKey = true
        default: break
        }
      }
      stateLock.unlock()
    }
    // Runner đóng kết nối: không còn ai xem, thoát ngay.
    if done || error != nil { exit(0) }
    readCommands()
  }
}
readCommands()

// MARK: - Quyền camera và tìm chiếc iPhone

var allow: UInt32 = 1
var allowAddress = CMIOObjectPropertyAddress(
  mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
  mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
  mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &allowAddress, 0, nil,
                          UInt32(MemoryLayout<UInt32>.size), &allow)

func waitForAccess() -> Bool {
  switch AVCaptureDevice.authorizationStatus(for: .video) {
  case .authorized: return true
  case .notDetermined:
    let done = DispatchSemaphore(value: 0)
    var granted = false
    AVCaptureDevice.requestAccess(for: .video) { ok in granted = ok; done.signal() }
    // Hộp thoại hiện trên màn hình máy chủ và chờ người bấm.
    while done.wait(timeout: .now() + 0.1) == .timedOut {
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    return granted
  default: return false
  }
}

if !waitForAccess() {
  fail("camera-denied", code: 3)
}

/// So tên không dấu, không phân biệt hoa thường: `devicectl` và AVFoundation
/// không luôn trả cùng một cách viết ("iPhone cua Anh" / "iPhone của Anh").
func plain(_ s: String) -> String {
  s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
    .replacingOccurrences(of: "đ", with: "d")
    .trimmingCharacters(in: .whitespaces)
}

func findDevice() -> AVCaptureDevice? {
  var candidates: [AVCaptureDevice] = []
  // Thiết bị màn hình iOS hiện ra vài trăm mili giây sau khi bật cờ ở trên.
  for _ in 0..<20 {
    candidates = AVCaptureDevice.DiscoverySession(
      deviceTypes: [.external], mediaType: nil, position: .unspecified
    ).devices.filter { $0.modelID == "iOS Device" }
    if let match = candidates.first(where: { plain($0.localizedName) == plain(options.name) }) {
      return match
    }
    RunLoop.current.run(until: Date().addingTimeInterval(0.5))
  }
  // Không khớp tên: chỉ nhận khi có ĐÚNG một chiếc — đoán giữa hai chiếc là
  // hiện màn hình của máy này lên màn điều khiển của máy kia.
  return candidates.count == 1 ? candidates[0] : nil
}

guard let device = findDevice() else {
  let names = AVCaptureDevice.DiscoverySession(
    deviceTypes: [.external], mediaType: nil, position: .unspecified
  ).devices.filter { $0.modelID == "iOS Device" }.map(\.localizedName)
  fail("device-not-found:\(names.joined(separator: ", "))", code: 4)
}

// MARK: - Mã hoá

let ciContext = CIContext(options: [.useSoftwareRenderer: false])

func fit(_ width: Int, _ height: Int, long: Int) -> (Int, Int) {
  let scale = min(1.0, Double(long) / Double(max(width, height)))
  // Chẵn: bộ mã hoá H.264 và bộ giải mã phía trình duyệt đều cần.
  let even = { (v: Double) in max(2, Int(v.rounded()) & ~1) }
  return (even(Double(width) * scale), even(Double(height) * scale))
}

func scaled(_ image: CIImage, to size: (Int, Int)) -> CIImage {
  let sx = Double(size.0) / image.extent.width
  let sy = Double(size.1) / image.extent.height
  return image.transformed(by: CGAffineTransform(scaleX: sx, y: sy))
}

final class H264Encoder {
  let width: Int
  let height: Int
  private var session: VTCompressionSession?
  private var pool: CVPixelBufferPool?

  init?(width: Int, height: Int) {
    self.width = width
    self.height = height
    var made: VTCompressionSession?
    let status = VTCompressionSessionCreate(
      allocator: nil, width: Int32(width), height: Int32(height),
      codecType: kCMVideoCodecType_H264, encoderSpecification: nil,
      imageBufferAttributes: nil, compressedDataAllocator: nil,
      outputCallback: nil, refcon: nil, compressionSessionOut: &made)
    guard status == noErr, let made else { return nil }
    session = made
    let set = { (key: CFString, value: CFTypeRef) in VTSessionSetProperty(made, key: key, value: value) }
    set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
    // Baseline, không khung B: trình duyệt giải mã ngay từng khung, không phải
    // chờ khung sau để sắp lại thứ tự — đó là độ trễ không cần có.
    set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_Baseline_AutoLevel)
    set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
    set(kVTCompressionPropertyKey_ExpectedFrameRate, options.fps as CFNumber)
    set(kVTCompressionPropertyKey_AverageBitRate, options.bitrate as CFNumber)
    // Khung khoá mỗi hai giây: người vào sau và người vừa bị bỏ bớt dữ liệu
    // không phải chờ lâu để có hình.
    set(kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, 2 as CFNumber)
    VTCompressionSessionPrepareToEncodeFrames(made)
    pool = VTCompressionSessionGetPixelBufferPool(made)
  }

  func encode(_ image: CIImage, at time: CMTime, key: Bool) {
    guard let session, let pool else { return }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
    guard let buffer else { return }
    ciContext.render(scaled(image, to: (width, height)), to: buffer)
    let props = key ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary : nil
    VTCompressionSessionEncodeFrame(
      session, imageBuffer: buffer, presentationTimeStamp: time, duration: .invalid,
      frameProperties: props, infoFlagsOut: nil
    ) { status, _, sample in
      guard status == noErr, let sample else { return }
      if let data = annexB(sample) { packet("h", data) }
    }
  }

  deinit {
    if let session { VTCompressionSessionInvalidate(session) }
  }
}

/// Mẫu H.264 của VideoToolbox (độ dài 4 byte trước mỗi NAL) → Annex-B (mã
/// bắt đầu 00 00 00 01), kèm SPS/PPS trước mỗi khung khoá. Đó là dạng mà
/// đường Android đã gửi và phía trình duyệt đã đọc.
func annexB(_ sample: CMSampleBuffer) -> Data? {
  guard let block = CMSampleBufferGetDataBuffer(sample) else { return nil }
  let start = Data([0, 0, 0, 1])
  var out = Data()
  let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]]
  let isKey = !(attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
  if isKey, let format = CMSampleBufferGetFormatDescription(sample) {
    var count = 0
    CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
      format, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil,
      parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
    for index in 0..<count {
      var pointer: UnsafePointer<UInt8>?
      var size = 0
      CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
        format, parameterSetIndex: index, parameterSetPointerOut: &pointer,
        parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil)
      if let pointer { out.append(start); out.append(pointer, count: size) }
    }
  }
  var total = 0
  var raw: UnsafeMutablePointer<CChar>?
  guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil,
                                    totalLengthOut: &total, dataPointerOut: &raw) == noErr,
        let raw else { return nil }
  var offset = 0
  while offset + 4 <= total {
    var length: UInt32 = 0
    memcpy(&length, raw + offset, 4)
    let nal = Int(UInt32(bigEndian: length))
    offset += 4
    guard offset + nal <= total else { break }
    out.append(start)
    raw.withMemoryRebound(to: UInt8.self, capacity: total) { out.append($0 + offset, count: nal) }
    offset += nal
  }
  return out
}

// MARK: - Quay

final class Capture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let deviceName: String
  private var encoder: H264Encoder?
  private var source: (Int, Int) = (0, 0)
  /// Mốc sớm nhất nhận khung kế tiếp. Không phải "cách khung trước ít nhất
  /// một nhịp": máy phát 40 khung/giây (25 ms) thì luật ấy bỏ ĐÚNG MỘT NỬA —
  /// ra 20 khung thay vì 30. Mốc cộng dồn giữ đúng nhịp trung bình.
  private var nextDue = Date.distantPast
  private let minGap = 1.0 / Double(max(1, options.fps))

  init(deviceName: String) {
    self.deviceName = deviceName
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    guard let pixels = CMSampleBufferGetImageBuffer(sample) else { return }
    let now = Date()
    // Trần tốc độ khung: máy phát tới 60 khung/giây khi đang cuộn, gấp đôi thứ
    // mắt người cần trên một màn điều khiển từ xa.
    if now < nextDue { return }
    // Không để mốc tụt xa phía sau sau một lúc màn hình đứng yên — nếu không,
    // khi máy phát lại thì mọi khung dồn ra một lúc.
    nextDue = max(nextDue.addingTimeInterval(minGap), now.addingTimeInterval(-minGap))

    let width = CVPixelBufferGetWidth(pixels)
    let height = CVPixelBufferGetHeight(pixels)
    if (width, height) != source {
      // Lần đầu, hoặc máy vừa xoay: dựng lại bộ mã hoá theo khổ mới và báo
      // runner để phía trình duyệt dựng lại bộ giải mã.
      source = (width, height)
      let h = fit(width, height, long: options.h264Long)
      let j = fit(width, height, long: options.jpegLong)
      encoder = H264Encoder(width: h.0, height: h.1)
      let info: [String: Any] = [
        "device": deviceName,
        "source": ["width": width, "height": height],
        "h264": ["width": h.0, "height": h.1],
        "jpeg": ["width": j.0, "height": j.1],
      ]
      packet("i", try! JSONSerialization.data(withJSONObject: info))
      stateLock.lock(); wantKey = true; stateLock.unlock()
    }

    stateLock.lock()
    let h264 = wantH264
    let jpeg = wantJpeg
    let key = wantKey
    if h264 { wantKey = false }
    stateLock.unlock()
    if !h264 && !jpeg { return }

    // Runner nhận không kịp: bỏ khung này. H.264 thì khung sau phải là khung
    // khoá, vì bỏ một khung P là hỏng hình tới khung khoá kế tiếp.
    if backlogged() {
      stateLock.lock(); wantKey = true; stateLock.unlock()
      return
    }

    let image = CIImage(cvPixelBuffer: pixels)
    if h264, let encoder {
      encoder.encode(image, at: CMSampleBufferGetPresentationTimeStamp(sample), key: key)
    }
    if jpeg {
      let size = fit(width, height, long: options.jpegLong)
      let space = CGColorSpace(name: CGColorSpace.sRGB)!
      if let data = ciContext.jpegRepresentation(
        of: scaled(image, to: size), colorSpace: space,
        options: [CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String):
                    options.jpegQuality]) {
        packet("j", data)
      }
    }
  }
}

let session = AVCaptureSession()
do {
  session.addInput(try AVCaptureDeviceInput(device: device))
} catch {
  fail("capture-failed:\(error.localizedDescription)", code: 5)
}
let output = AVCaptureVideoDataOutput()
output.alwaysDiscardsLateVideoFrames = true
output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
let capture = Capture(deviceName: device.localizedName)
output.setSampleBufferDelegate(capture, queue: DispatchQueue(label: "capture"))
session.addOutput(output)
session.startRunning()

RunLoop.main.run()
