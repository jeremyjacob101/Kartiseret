import CoreImage.CIFilterBuiltins
import CoreImage
import Foundation
import ImageIO
import PassKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import UIKit
import UserNotifications
import Vision

extension Notification.Name {
    static let kartiseretTicketReminderTapped = Notification.Name("kartiseret.ticketReminderTapped")
}

actor WalletTicketOfflineCache {
    static let shared = WalletTicketOfflineCache()

    private struct Snapshot: Codable {
        let accountID: String
        var tickets: [WalletTicket]
        var details: [String: WalletTicketDetail]
    }

    func loadTickets(accountID: String) -> [WalletTicket]? {
        load(accountID: accountID)?.tickets
    }

    func loadDetail(ticketID: String, accountID: String) -> WalletTicketDetail? {
        load(accountID: accountID)?.details[ticketID]
    }

    func storeTickets(_ tickets: [WalletTicket], accountID: String) {
        var snapshot = load(accountID: accountID) ?? Snapshot(
            accountID: accountID,
            tickets: [],
            details: [:]
        )
        let currentByID = Dictionary(uniqueKeysWithValues: tickets.map { ($0.id, $0) })
        snapshot.tickets = tickets
        snapshot.details = snapshot.details.filter { id, detail in
            currentByID[id]?.updatedAt == detail.updatedAt
        }
        save(snapshot)
    }

    func storeDetail(_ detail: WalletTicketDetail, accountID: String) {
        storeDetails([detail], accountID: accountID)
    }

    func storeDetails(_ details: [WalletTicketDetail], accountID: String) {
        var snapshot = load(accountID: accountID) ?? Snapshot(
            accountID: accountID,
            tickets: [],
            details: [:]
        )
        for detail in details {
            snapshot.details[detail.id] = detail
            let summary = WalletTicket(
                id: detail.id,
                tmdbId: detail.tmdbId,
                title: detail.title,
                city: detail.city,
                cinema: detail.cinema,
                screeningDate: detail.screeningDate,
                screeningTime: detail.screeningTime,
                reminderEnabled: detail.reminderEnabled,
                createdAt: detail.createdAt,
                updatedAt: detail.updatedAt
            )
            if let index = snapshot.tickets.firstIndex(where: { $0.id == detail.id }) {
                snapshot.tickets[index] = summary
            } else {
                snapshot.tickets.append(summary)
            }
        }
        snapshot.tickets.sort {
            ($0.screeningDate, $0.screeningTime, $0.createdAt) <
                ($1.screeningDate, $1.screeningTime, $1.createdAt)
        }
        save(snapshot)
    }

    func remove(ticketID: String, accountID: String) {
        guard var snapshot = load(accountID: accountID) else { return }
        snapshot.tickets.removeAll { $0.id == ticketID }
        snapshot.details[ticketID] = nil
        save(snapshot)
    }

    func clear(accountID: String) {
        guard let url = fileURL(accountID: accountID) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private func load(accountID: String) -> Snapshot? {
        guard let url = fileURL(accountID: accountID),
              let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
              snapshot.accountID == accountID else { return nil }
        return snapshot
    }

    private func save(_ snapshot: Snapshot) {
        guard let url = fileURL(accountID: snapshot.accountID),
              let data = try? JSONEncoder().encode(snapshot) else { return }
        do {
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.complete],
                ofItemAtPath: url.path
            )
            var resourceValues = URLResourceValues()
            resourceValues.isExcludedFromBackup = true
            var cacheURL = url
            try cacheURL.setResourceValues(resourceValues)
        } catch {
            // Ticket QR payloads are cached only when they can be stored safely.
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func fileURL(accountID: String) -> URL? {
        let safeID = String(accountID.filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") })
        guard !safeID.isEmpty,
              let supportDirectory = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
              ).first else { return nil }
        let directory = supportDirectory.appendingPathComponent("KartiseretWalletTickets", isDirectory: true)
        do {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete]
            )
        } catch {
            return nil
        }
        return directory.appendingPathComponent("\(safeID).json", isDirectory: false)
    }
}

@MainActor
enum TicketReminderManager {
    nonisolated static let identifierPrefix = "kartiseret.ticket-reminder."
    private static let pendingTappedTicketIDKey = "kartiseret.ticket.pendingReminderTicketID"
    private static let maximumPendingRequests = 64
    private static let timeZone = TimeZone(identifier: "Asia/Jerusalem") ?? .current

    static func reminderDate(for ticket: WalletTicket) -> Date? {
        screeningDate(date: ticket.screeningDate, time: ticket.screeningTime)
            .map { $0.addingTimeInterval(-15 * 60) }
    }

    static func reminderDate(for ticket: WalletTicketDetail) -> Date? {
        screeningDate(date: ticket.screeningDate, time: ticket.screeningTime)
            .map { $0.addingTimeInterval(-15 * 60) }
    }

    static func cancel(ticketID: String) async {
        let center = UNUserNotificationCenter.current()
        let identifier = identifierPrefix + ticketID
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }

    static func cancelAll() async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(
            withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(identifierPrefix) }
        )
        let delivered = await center.deliveredNotifications()
        center.removeDeliveredNotifications(
            withIdentifiers: delivered.map(\.request.identifier).filter { $0.hasPrefix(identifierPrefix) }
        )
    }

    static func rememberTappedTicket(_ ticketID: String) {
        guard UUID(uuidString: ticketID) != nil else { return }
        UserDefaults.standard.set(ticketID, forKey: pendingTappedTicketIDKey)
    }

    static func takePendingTappedTicketID() -> String? {
        guard let ticketID = UserDefaults.standard.string(forKey: pendingTappedTicketIDKey),
              UUID(uuidString: ticketID) != nil else {
            UserDefaults.standard.removeObject(forKey: pendingTappedTicketIDKey)
            return nil
        }
        UserDefaults.standard.removeObject(forKey: pendingTappedTicketIDKey)
        return ticketID
    }

    static func reconcile(tickets: [WalletTicket]) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        let otherPendingCount = pending.filter {
            !$0.identifier.hasPrefix(identifierPrefix)
        }.count
        center.removePendingNotificationRequests(
            withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(identifierPrefix) }
        )
        let enabledTicketIdentifiers = Set(
            tickets.filter(\.reminderEnabled).map { identifierPrefix + $0.id }
        )
        let delivered = await center.deliveredNotifications()
        center.removeDeliveredNotifications(
            withIdentifiers: delivered
                .map(\.request.identifier)
                .filter { $0.hasPrefix(identifierPrefix) && !enabledTicketIdentifiers.contains($0) }
        )
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized ||
                settings.authorizationStatus == .provisional ||
                settings.authorizationStatus == .ephemeral else { return }
        let upcoming = tickets.compactMap { ticket -> (ticket: WalletTicket, fireDate: Date)? in
            guard ticket.reminderEnabled,
                  let fireDate = reminderDate(for: ticket),
                  fireDate > .now else { return nil }
            return (ticket, fireDate)
        }.sorted { $0.fireDate < $1.fireDate }
        let availableSlots = max(0, maximumPendingRequests - otherPendingCount)
        for entry in upcoming.prefix(availableSlots) {
            try? await center.add(request(for: entry.ticket, fireDate: entry.fireDate))
        }
    }

    static func refreshFromServer(account: AccountStore) async {
        switch account.state {
        case .signedIn:
            break
        case .guest:
            await cancelAll()
            return
        case .restoring:
            return
        case .unavailable:
            guard account.identity != nil else {
                await cancelAll()
                return
            }
        }
        do {
            let page: WalletTicketList = try await account.requestPrivate(
                path: "/api/v1/ticket-passes",
                method: "GET",
                as: WalletTicketList.self
            )
            await reconcile(tickets: page.tickets)
        } catch {
            // Existing scheduled reminders can still fire during a temporary API outage.
        }
    }

    static func reschedule(_ ticket: WalletTicket) async throws {
        guard ticket.reminderEnabled, let fireDate = reminderDate(for: ticket), fireDate > .now else {
            await cancel(ticketID: ticket.id)
            return
        }
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized ||
                settings.authorizationStatus == .provisional ||
                settings.authorizationStatus == .ephemeral else {
            await cancel(ticketID: ticket.id)
            throw ReminderError.permissionDenied
        }
        do {
            try await center.add(request(for: ticket, fireDate: fireDate))
        } catch {
            await cancel(ticketID: ticket.id)
            throw error
        }
    }

    static func enable(for ticket: WalletTicketDetail) async throws {
        guard let fireDate = reminderDate(for: ticket), fireDate > .now else {
            throw ReminderError.screeningTooSoon
        }
        let center = UNUserNotificationCenter.current()
        let identifier = identifierPrefix + ticket.id
        let pending = await center.pendingNotificationRequests()
        if !pending.contains(where: { $0.identifier == identifier }),
           pending.count >= maximumPendingRequests {
            throw ReminderError.tooManyReminders
        }
        let settings = await center.notificationSettings()
        let allowed: Bool
        switch settings.authorizationStatus {
        case .notDetermined:
            allowed = try await center.requestAuthorization(options: [.alert, .sound])
        case .authorized, .provisional, .ephemeral:
            allowed = true
        case .denied:
            allowed = false
        @unknown default:
            allowed = false
        }
        guard allowed else { throw ReminderError.permissionDenied }
        try await center.add(request(for: ticket, fireDate: fireDate))
    }

    private static func request(for ticket: WalletTicket, fireDate: Date) -> UNNotificationRequest {
        request(
            id: ticket.id,
            title: ticket.title,
            cinema: ticket.cinema,
            fireDate: fireDate
        )
    }

    private static func request(for ticket: WalletTicketDetail, fireDate: Date) -> UNNotificationRequest {
        request(
            id: ticket.id,
            title: ticket.title,
            cinema: ticket.cinema,
            fireDate: fireDate
        )
    }

    private static func request(id: String, title: String, cinema: String, fireDate: Date) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = "Movie time soon"
        content.body = "\(title) at \(cinema) starts in 15 minutes."
        content.sound = .default
        content.userInfo = ["ticketId": id]
        let trigger = UNTimeIntervalNotificationTrigger(
            timeInterval: max(1, fireDate.timeIntervalSinceNow),
            repeats: false
        )
        return UNNotificationRequest(
            identifier: identifierPrefix + id,
            content: content,
            trigger: trigger
        )
    }

    private static func screeningDate(date: String, time: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.date(from: "\(date) \(String(time.prefix(5)))")
    }

    enum ReminderError: LocalizedError {
        case permissionDenied
        case screeningTooSoon
        case tooManyReminders

        var errorDescription: String? {
            switch self {
            case .permissionDenied: "Allow Kartiseret notifications in Settings to receive this reminder."
            case .screeningTooSoon: "The 15 minute reminder time has already passed for this screening."
            case .tooManyReminders: "This iPhone has reached its scheduled notification limit. Turn off another reminder and try again."
            }
        }
    }
}

struct TicketPassesView: View {
    @Environment(AccountStore.self) private var account
    let initialTicketID: String?

    @State private var tickets: [WalletTicket] = []
    @State private var listedScreenings: [WalletTicketScreening] = []
    @State private var isShowingListedScreenings = false
    @State private var isLoadingListedScreenings = false
    @State private var detailRequestID = UUID()
    @State private var isShowingTicketDetail = false
    @State private var detailTicketID: String?
    @State private var hasOpenedInitialTicket = false
    @State private var selectedTicket: WalletTicketDetail?
    @State private var editingTicketID: String?
    @State private var form = WalletTicketScreening(
        tmdbId: nil,
        title: "",
        city: "",
        cinema: "",
        screeningDate: "",
        screeningTime: ""
    )
    @State private var qrMessages: [String] = []
    @State private var pendingAdditionalTicketID: String?
    @State private var pendingAdditionalQrMessages: [String] = []
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var additionalPhotoItems: [PhotosPickerItem] = []
    @State private var isLoading = true
    @State private var isReadingScreenshot = false
    @State private var isSaving = false
    @State private var isPreparingPass = false
    @State private var isAppendingQrCodes = false
    @State private var isShowingPassSheet = false
    @State private var passesForSheet: [PKPass]?
    @State private var isShowingDeleteConfirmation = false
    @State private var isShowingReminderSettings = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var scanMessage: String?
    @State private var hasInteractedWithScreening = false
    @State private var hasConfirmedShowDate = false
    @State private var hasConfirmedShowTime = false
    @State private var isImportingAdditionalScreenshots = false

    init(initialTicketID: String? = nil) {
        self.initialTicketID = initialTicketID
    }

    private var jerusalemTimeZone: TimeZone {
        TimeZone(identifier: "Asia/Jerusalem") ?? .current
    }

    private var jerusalemCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = jerusalemTimeZone
        return calendar
    }

    private var showDate: Binding<Date> {
        Binding(
            get: { parseScreeningDate(form.screeningDate) ?? .now },
            set: {
                form.screeningDate = formatDate($0)
                hasConfirmedShowDate = true
                hasInteractedWithScreening = true
            }
        )
    }

    private var showTime: Binding<Date> {
        Binding(
            get: { parseScreeningTime(form.screeningTime) ?? .now },
            set: {
                form.screeningTime = formatTime($0)
                hasConfirmedShowTime = true
                hasInteractedWithScreening = true
            }
        )
    }

    var body: some View {
        Form {
            if account.identity == nil {
                Section {
                    Text("Sign in to import and sync tickets across Kartiseret on the web and iPhone.")
                        .foregroundStyle(.secondary)
                }
            } else {
                if editingTicketID == nil { savedTicketsSection }
                if account.state == .signedIn {
                    if editingTicketID == nil { importSection }
                    screeningSection
                } else {
                    Section {
                        Text("You’re offline. Tickets saved on this iPhone are available below; connect to import, edit, or sync tickets.")
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("My Tickets")
        .navigationBarTitleDisplayMode(.inline)
        .tint(Color(hexString: account.preferences.siteColor) ?? BrandStyle.accent)
        .task {
            if !hasOpenedInitialTicket, let initialTicketID, !initialTicketID.isEmpty,
               account.identity != nil {
                hasOpenedInitialTicket = true
                openTicket(initialTicketID)
            }
            await loadTickets()
        }
        .refreshable { await loadTickets() }
        .navigationDestination(isPresented: $isShowingTicketDetail) { ticketDetail }
        .onChange(of: isShowingTicketDetail) { _, showing in
            guard !showing else { return }
            detailRequestID = UUID()
            detailTicketID = nil
            selectedTicket = nil
        }
        .safeAreaInset(edge: .bottom) {
            if account.state != .signedIn, let errorMessage {
                Text(errorMessage).font(.footnote).padding()
            }
        }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await readPhotoPickerItems(items, ticketID: nil) }
        }
        .fileImporter(
            isPresented: Binding(get: { isImportingScreenshot }, set: { isImportingScreenshot = $0 }),
            allowedContentTypes: [.image],
            allowsMultipleSelection: true
        ) { result in
            Task { await readImportedFiles(result, ticketID: nil) }
        }
        .sheet(isPresented: $isShowingListedScreenings) {
            NavigationStack {
                List {
                    ForEach(listedScreenings.indices, id: \.self) { index in
                        let screening = listedScreenings[index]
                        Button {
                            form = screening
                            hasInteractedWithScreening = true
                            hasConfirmedShowDate = true
                            hasConfirmedShowTime = true
                            statusMessage = "Review the selected screening before saving."
                            isShowingListedScreenings = false
                        } label: {
                            VStack(alignment: .leading) {
                                Text(screening.title)
                                Text("\(screening.screeningTime) · \(screening.cinema)")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .navigationTitle("Listed screenings")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { isShowingListedScreenings = false }
                    }
                }
            }
        }
    }

    private var ticketDetail: some View {
        Form {
            if let selectedTicket {
                selectedTicketSection(selectedTicket)
            } else if errorMessage == nil {
                ProgressView("Loading ticket QR codes…")
            }
            if let errorMessage, !isShowingReminderSettings {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                    if selectedTicket == nil, let detailTicketID {
                        Button("Retry") { Task { await loadTicket(detailTicketID) } }
                    }
                }
            }
            if let statusMessage {
                Text(statusMessage).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle(selectedTicket?.title ?? "Ticket details")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .task(id: detailTicketID) {
            if let detailTicketID { await loadTicket(detailTicketID) }
        }
        .onChange(of: additionalPhotoItems) { _, items in
            guard !items.isEmpty, let ticketID = selectedTicket?.id else { return }
            Task { await readPhotoPickerItems(items, ticketID: ticketID) }
        }
        .fileImporter(isPresented: $isImportingAdditionalScreenshots, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
            guard let ticketID = selectedTicket?.id else { return }
            Task { await readImportedFiles(result, ticketID: ticketID) }
        }
        .sheet(isPresented: $isShowingPassSheet, onDismiss: { passesForSheet = nil }) {
            if let passesForSheet { AddWalletPassSheet(passes: passesForSheet) }
        }
        .confirmationDialog(
            "Delete this ticket?",
            isPresented: $isShowingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete ticket", role: .destructive) { Task { await deleteSelectedTicket() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the ticket from Kartiseret and cancels its reminder on this device.")
        }
        .alert("Notifications are off", isPresented: $isShowingReminderSettings) {
            Button("Open Settings") {
                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                UIApplication.shared.open(url)
            }
            Button("Not now", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "Enable notifications to receive a ticket reminder.")
        }
    }

    @State private var isImportingScreenshot = false

    private var importSection: some View {
        Section {
            if isReadingScreenshot { ProgressView("Reading ticket QR codes on this iPhone…") }
            PhotosPicker(selection: $photoItems, maxSelectionCount: 10, matching: .images) {
                Label("Choose ticket screenshots from Photos", systemImage: "qrcode.viewfinder")
            }
            .disabled(isReadingScreenshot || isSaving)
            Button {
                isImportingScreenshot = true
            } label: {
                Label("Choose screenshot from Files", systemImage: "folder")
            }
            .disabled(isReadingScreenshot || isSaving)
            Text("Choose multiple screenshots or include several QR codes in one image. QR reading happens on this iPhone; screenshots are not uploaded or saved. Printed showtime details are not read automatically, so review them below.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if !qrMessages.isEmpty {
                Label("\(qrMessages.count) ticket QR code\(qrMessages.count == 1 ? "" : "s") ready", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("The QR contents will be saved privately with this booking so its Wallet passes can be recreated.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                ForEach(qrMessages.indices, id: \.self) { index in
                    HStack {
                        Text("Ticket \(index + 1)")
                        Spacer()
                        Button("Remove", role: .destructive) {
                            qrMessages.remove(at: index)
                        }
                    }
                }
            }
            if let scanMessage {
                Text(scanMessage).font(.footnote).foregroundStyle(.orange)
            }
        } header: {
            Text("Import ticket QR codes")
        }
    }

    private var screeningSection: some View {
        Section {
            TextField("Movie or show", text: screeningTextBinding(\.title))
                .textInputAutocapitalization(.words)
            TextField("City", text: screeningTextBinding(\.city))
                .textInputAutocapitalization(.words)
            TextField("Cinema", text: screeningTextBinding(\.cinema))
                .textInputAutocapitalization(.words)
            DatePicker("Show date", selection: showDate, displayedComponents: .date)
                .environment(\.calendar, jerusalemCalendar)
                .environment(\.timeZone, jerusalemTimeZone)
            DatePicker("Showtime", selection: showTime, displayedComponents: .hourAndMinute)
                .environment(\.calendar, jerusalemCalendar)
                .environment(\.timeZone, jerusalemTimeZone)
            if !hasConfirmedShowDate {
                Button("Use displayed date") { showDate.wrappedValue = showDate.wrappedValue }
            }
            if !hasConfirmedShowTime {
                Button("Use displayed time") { showTime.wrappedValue = showTime.wrappedValue }
            }
            Button("Find listed screenings") {
                Task { await loadListedScreenings() }
            }
            .disabled(!hasConfirmedShowDate || form.city.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isLoadingListedScreenings || isSaving)
            Text("Enter a city and date to look up a screening.")
                .font(.footnote).foregroundStyle(.secondary)
            if !hasConfirmedShowDate || !hasConfirmedShowTime {
                Text("Confirm both the show date and time, or use a recent showtime suggestion, before saving.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let statusMessage {
                Text(statusMessage).font(.footnote).foregroundStyle(.secondary)
            }
            if let errorMessage, !isShowingReminderSettings {
                Text(errorMessage).font(.footnote).foregroundStyle(.red)
            }
            Button {
                Task { await saveTicket() }
            } label: {
                if isSaving { ProgressView() }
                else { Text(editingTicketID == nil ? "Save to My Tickets" : "Save ticket changes") }
            }
            .disabled(isSaving || isLoading || !isValidForm)
            .frame(maxWidth: .infinity)
            if editingTicketID != nil {
                Button("Cancel editing", role: .cancel) { cancelEditing() }
                    .frame(maxWidth: .infinity)
            }
        } header: {
            HStack {
                Text("Screening details")
                Spacer()
                if statusMessage?.localizedCaseInsensitiveContains("latest") == true {
                    Text("Latest click")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(BrandStyle.accent)
                }
            }
        } footer: {
            Text("Check the date and time before saving. Kartiseret prefilled the latest showtime you opened when it could match one.")
        }
    }

    private var savedTicketsSection: some View {
        Section("Saved tickets") {
            if isLoading {
                ProgressView("Loading your tickets…")
            } else if tickets.isEmpty {
                Text("No tickets saved yet. Import a screenshot to get started.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(tickets) { ticket in
                    Button {
                        openTicket(ticket.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(ticket.title).font(.headline).foregroundStyle(.primary)
                                Spacer()
                                if ticket.reminderEnabled {
                                    Image(systemName: "bell.badge.fill")
                                        .foregroundStyle(BrandStyle.accent)
                                        .accessibilityLabel("Reminder enabled")
                                }
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                            Text("\(ticket.cinema) · \(ticket.city)")
                                .font(.subheadline).foregroundStyle(.secondary)
                            Text("\(displayDate(ticket.screeningDate)) · \(ticket.screeningTime)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private func selectedTicketSection(_ ticket: WalletTicketDetail) -> some View {
        Section {
            ForEach(ticket.qrCodes.indices, id: \.self) { index in
                let code = ticket.qrCodes[index]
                VStack(spacing: 9) {
                    if ticket.qrCodes.count > 1 {
                        Text("Ticket \(index + 1) of \(ticket.qrCodes.count)")
                            .font(.headline)
                    }
                    SavedTicketQRCode(message: code.qrMessage, label: "Ticket QR code \(index + 1) of \(ticket.qrCodes.count)")
                }
                .padding(.vertical, 5)
            }
            Text("Show the matching QR from Kartiseret for each person if Apple Wallet is unavailable. You can add screenshots to this booking at any time.")
                .font(.footnote).foregroundStyle(.secondary)
            if account.state == .signedIn {
                if isReadingScreenshot { ProgressView("Reading ticket QR codes…") }
                PhotosPicker(selection: $additionalPhotoItems, maxSelectionCount: 10, matching: .images) {
                    Label("Add more ticket screenshots from Photos", systemImage: "plus")
                }
                .disabled(isReadingScreenshot || isAppendingQrCodes || ticket.qrCodes.count >= 10)
                Button {
                    isImportingAdditionalScreenshots = true
                } label: {
                    Label("Add more screenshots from Files", systemImage: "folder.badge.plus")
                }
                .disabled(isReadingScreenshot || isAppendingQrCodes || ticket.qrCodes.count >= 10)
                if pendingAdditionalTicketID == ticket.id,
                   !pendingAdditionalQrMessages.isEmpty {
                    Text("\(pendingAdditionalQrMessages.count) scanned QR code\(pendingAdditionalQrMessages.count == 1 ? "" : "s") are waiting to be saved.")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                    Button("Retry saving QR codes") {
                        Task { await savePendingAdditionalQrCodes(for: ticket.id) }
                    }
                    .disabled(isAppendingQrCodes)
                }
                if ticket.qrCodes.count >= 10 {
                    Text("This booking has the maximum of 10 ticket QR codes.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let scanMessage {
                    Text(scanMessage).font(.footnote).foregroundStyle(.orange)
                }
            }
            Button {
                Task { await addOrUpdateWalletPass(ticket) }
            } label: {
                if isPreparingPass { ProgressView() }
                else {
                    Label(
                        ticket.qrCodes.count > 1 ? "Add all tickets to Apple Wallet" : "Add or Update in Apple Wallet",
                        systemImage: "wallet.pass"
                    )
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(BrandStyle.accent)
            .disabled(isPreparingPass)

            Toggle(isOn: Binding(
                get: { ticket.reminderEnabled },
                set: { value in Task { await changeReminder(value, for: ticket) } }
            )) {
                Label("Remind me 15 minutes before", systemImage: "bell.badge")
            }
            .accessibilityIdentifier("walletTicket.reminder")
            if ticket.reminderEnabled {
                Text("One notification opens this booking and all its ticket QR codes. Apple Wallet may also show its passes when relevant.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            HStack {
                Button("Edit details") {
                    beginEditing(ticket)
                    isShowingTicketDetail = false
                }
                Spacer()
                Button("Delete ticket", role: .destructive) { isShowingDeleteConfirmation = true }
            }
            .buttonStyle(.borderless)
            .disabled(account.state != .signedIn)
        } header: {
            Text("\(ticket.cinema), \(ticket.city) · \(displayDate(ticket.screeningDate)) at \(ticket.screeningTime)")
        }
    }

    private var isValidForm: Bool {
        (editingTicketID != nil || !qrMessages.isEmpty) &&
        hasConfirmedShowDate &&
        hasConfirmedShowTime &&
        !form.screeningDate.isEmpty &&
        !form.screeningTime.isEmpty &&
        !form.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !form.city.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !form.cinema.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func screeningTextBinding(
        _ keyPath: WritableKeyPath<WalletTicketScreening, String>
    ) -> Binding<String> {
        Binding(
            get: { form[keyPath: keyPath] },
            set: {
                form[keyPath: keyPath] = $0
                hasInteractedWithScreening = true
            }
        )
    }

    private func loadTickets() async {
        guard let accountID = account.identity?.id else { isLoading = false; return }
        isLoading = true
        errorMessage = nil
        if account.state != .signedIn {
            tickets = await WalletTicketOfflineCache.shared.loadTickets(accountID: accountID) ?? []
            statusMessage = tickets.isEmpty
                ? "No tickets have been saved on this iPhone yet. Connect to your account to sync them."
                : "Offline copies are shown. Connect to refresh ticket details and reminders."
            isLoading = false
            return
        }
        if let cachedTickets = await WalletTicketOfflineCache.shared.loadTickets(accountID: accountID) {
            tickets = cachedTickets
            isLoading = false
            statusMessage = "Showing tickets saved on this iPhone while the list refreshes."
        }
        defer { isLoading = false }
        var loadedFromServer = false
        do {
            let page: WalletTicketList = try await account.requestPrivate(
                path: "/api/v1/ticket-passes",
                method: "GET",
                as: WalletTicketList.self
            )
            tickets = page.tickets
            loadedFromServer = true
            statusMessage = nil
            await WalletTicketOfflineCache.shared.storeTickets(page.tickets, accountID: accountID)
            do {
                let details: WalletTicketDetailsPage = try await account.requestPrivate(
                    path: "/api/v1/ticket-passes/offline-cache",
                    method: "GET",
                    as: WalletTicketDetailsPage.self
                )
                await WalletTicketOfflineCache.shared.storeDetails(details.tickets, accountID: accountID)
            } catch {
                // Keep the ticket list usable when warming its offline QR cache fails.
            }
            if account.state == .signedIn {
                await TicketReminderManager.reconcile(tickets: page.tickets)
            }
        } catch {
            if let cachedTickets = await WalletTicketOfflineCache.shared.loadTickets(accountID: accountID) {
                tickets = cachedTickets
                statusMessage = "Showing the tickets saved on this iPhone. Connect to refresh them."
            } else {
                errorMessage = error.localizedDescription
            }
        }
        if loadedFromServer,
                  !isShowingTicketDetail,
                  !hasInteractedWithScreening,
                  let recent = try? await account.requestPrivate(
                path: "/api/v1/ticket-passes/recent-screening",
                method: "GET",
                as: WalletTicketRecentScreeningPage.self
            ).screening {
                apply(recent)
                statusMessage = "Prefilled from your latest Kartiseret showtime click. Review the details."
        }
    }

    private func loadListedScreenings() async {
        let city = form.city.trimmingCharacters(in: .whitespacesAndNewlines)
        let date = form.screeningDate
        let editID = editingTicketID
        var components = URLComponents()
        components.path = "/api/v1/ticket-passes/listed-screenings"
        components.queryItems = [
            URLQueryItem(name: "city", value: city),
            URLQueryItem(name: "date", value: date)
        ]
        guard let path = components.string else { return }
        isLoadingListedScreenings = true
        errorMessage = nil
        defer { isLoadingListedScreenings = false }
        struct ScreeningsPage: Decodable, Sendable { let screenings: [WalletTicketScreening] }
        do {
            let page = try await account.requestPrivate(path: path, method: "GET", as: ScreeningsPage.self)
            guard form.city.trimmingCharacters(in: .whitespacesAndNewlines) == city,
                  form.screeningDate == date, editingTicketID == editID else { return }
            listedScreenings = page.screenings
            isShowingListedScreenings = !listedScreenings.isEmpty
            if listedScreenings.isEmpty {
                statusMessage = "No screenings found. Enter the details manually."
            }
        } catch {
            errorMessage = "Listings are unavailable. Enter the details manually or retry."
        }
    }

    private func openTicket(_ id: String) {
        detailTicketID = id
        selectedTicket = nil
        scanMessage = nil
        errorMessage = nil
        statusMessage = nil
        isShowingTicketDetail = true
    }

    private func loadTicket(_ id: String) async {
        guard let accountID = account.identity?.id, isShowingTicketDetail, detailTicketID == id else { return }
        let requestID = UUID()
        detailRequestID = requestID
        func isCurrent() -> Bool {
            !Task.isCancelled && isShowingTicketDetail && detailTicketID == id
                && detailRequestID == requestID && account.identity?.id == accountID
        }

        let cachedTicket = await WalletTicketOfflineCache.shared.loadDetail(ticketID: id, accountID: accountID)
        guard isCurrent() else { return }
        if selectedTicket?.id != id { selectedTicket = cachedTicket }
        errorMessage = nil
        guard account.state == .signedIn else {
            if cachedTicket == nil {
                errorMessage = "Connect to load this ticket’s QR code."
            }
            return
        }

        do {
            let page: WalletTicketDetailPage = try await account.requestPrivate(
                path: "/api/v1/ticket-passes/\(id)/family",
                method: "GET",
                as: WalletTicketDetailPage.self
            )
            guard isCurrent() else { return }
            selectedTicket = page.ticket
            statusMessage = nil
            await WalletTicketOfflineCache.shared.storeDetail(page.ticket, accountID: accountID)
        } catch let error as APIClientError where error.code == "ticket_not_found" {
            guard isCurrent() else { return }
            selectedTicket = nil
            tickets.removeAll { $0.id == id }
            if editingTicketID == id { cancelEditing() }
            errorMessage = error.localizedDescription
            await WalletTicketOfflineCache.shared.remove(ticketID: id, accountID: accountID)
            await TicketReminderManager.cancel(ticketID: id)
        } catch {
            guard isCurrent() else { return }
            if cachedTicket != nil {
                statusMessage = "Offline copy shown. Check the cinema’s original ticket for the latest status."
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func saveTicket() async {
        guard isValidForm else {
            errorMessage = "Add a readable QR code and complete the screening details."
            return
        }
        isSaving = true
        errorMessage = nil
        statusMessage = nil
        defer { isSaving = false }
        do {
            let isEditing = editingTicketID != nil
            var payload: [String: Any] = [
                "tmdbId": form.tmdbId.map { $0 as Any } ?? NSNull(),
                "title": form.title.trimmingCharacters(in: .whitespacesAndNewlines),
                "city": form.city.trimmingCharacters(in: .whitespacesAndNewlines),
                "cinema": form.cinema.trimmingCharacters(in: .whitespacesAndNewlines),
                "screeningDate": formatDate(showDate.wrappedValue),
                "screeningTime": formatTime(showTime.wrappedValue),
            ]
            let path: String
            let method: String
            if let editingTicketID {
                path = "/api/v1/ticket-passes/\(editingTicketID)"
                method = "PATCH"
            } else {
                path = "/api/v1/ticket-passes"
                method = "POST"
                payload["reminderEnabled"] = false
                payload["qrMessages"] = qrMessages
            }
            let body = try JSONSerialization.data(withJSONObject: payload)
            let saved: WalletTicketChangePage = try await account.requestPrivate(
                path: path,
                method: method,
                body: body,
                as: WalletTicketChangePage.self
            )
            var reminderFailure: String?
            if isEditing {
                do {
                    try await TicketReminderManager.reschedule(saved.ticket)
                } catch {
                    reminderFailure = "Ticket saved. The reminder could not be updated: \(error.localizedDescription)"
                }
            }
            editingTicketID = nil
            form = emptyForm
            qrMessages = []
            hasInteractedWithScreening = false
            hasConfirmedShowDate = false
            hasConfirmedShowTime = false
            await loadTicketListOnly()
            openTicket(saved.ticket.id)
            if let reminderFailure { errorMessage = reminderFailure }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func loadTicketListOnly() async {
        do {
            let page: WalletTicketList = try await account.requestPrivate(
                path: "/api/v1/ticket-passes",
                method: "GET",
                as: WalletTicketList.self
            )
            tickets = page.tickets
            if let accountID = account.identity?.id {
                await WalletTicketOfflineCache.shared.storeTickets(page.tickets, accountID: accountID)
            }
            await TicketReminderManager.reconcile(tickets: page.tickets)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteSelectedTicket() async {
        guard let ticket = selectedTicket else { return }
        do {
            _ = try await account.requestPrivate(
                path: "/api/v1/ticket-passes/\(ticket.id)",
                method: "DELETE"
            )
            await TicketReminderManager.cancel(ticketID: ticket.id)
            if let accountID = account.identity?.id {
                await WalletTicketOfflineCache.shared.remove(ticketID: ticket.id, accountID: accountID)
            }
            if detailTicketID == ticket.id { isShowingTicketDetail = false }
            if editingTicketID == ticket.id { cancelEditing() }
            statusMessage = "Ticket deleted."
            await loadTicketListOnly()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func beginEditing(_ ticket: WalletTicketDetail) {
        editingTicketID = ticket.id
        form = WalletTicketScreening(
            tmdbId: ticket.tmdbId,
            title: ticket.title,
            city: ticket.city,
            cinema: ticket.cinema,
            screeningDate: ticket.screeningDate,
            screeningTime: ticket.screeningTime
        )
        qrMessages = []
        hasInteractedWithScreening = true
        hasConfirmedShowDate = true
        hasConfirmedShowTime = true
        statusMessage = nil
        errorMessage = nil
    }

    private func cancelEditing() {
        editingTicketID = nil
        qrMessages = []
        form = emptyForm
        statusMessage = nil
        errorMessage = nil
        hasInteractedWithScreening = false
        hasConfirmedShowDate = false
        hasConfirmedShowTime = false
    }

    private func changeReminder(_ enabled: Bool, for ticket: WalletTicketDetail) async {
        do {
            if enabled {
                try await TicketReminderManager.enable(for: ticket)
            } else {
                await TicketReminderManager.cancel(ticketID: ticket.id)
            }
            let body = try JSONSerialization.data(withJSONObject: ["reminderEnabled": enabled])
            let _: WalletTicketChangePage = try await account.requestPrivate(
                path: "/api/v1/ticket-passes/\(ticket.id)",
                method: "PATCH",
                body: body,
                as: WalletTicketChangePage.self
            )
            await loadTicket(ticket.id)
            await loadTicketListOnly()
            statusMessage = enabled ? "15 minute reminder enabled." : "Reminder turned off."
        } catch TicketReminderManager.ReminderError.permissionDenied {
            errorMessage = "Notifications are disabled for Kartiseret. Open Settings to allow the reminder."
            isShowingReminderSettings = true
        } catch {
            await TicketReminderManager.cancel(ticketID: ticket.id)
            let failure = error.localizedDescription
            await loadTicket(ticket.id)
            await loadTicketListOnly()
            errorMessage = failure
        }
    }

    private func addOrUpdateWalletPass(_ ticket: WalletTicketDetail) async {
        isPreparingPass = true
        errorMessage = nil
        statusMessage = nil
        defer { isPreparingPass = false }
        do {
            guard PKAddPassesViewController.canAddPasses() else {
                throw TicketPassError.walletUnavailable
            }
            var passes: [PKPass] = []
            for code in ticket.qrCodes {
                let data = try await account.requestPrivateFile(
                    path: "/api/v1/ticket-passes/\(ticket.id)/codes/\(code.id)/pass.pkpass",
                    contentType: "application/vnd.apple.pkpass"
                )
                passes.append(try PKPass(data: data))
            }
            guard !passes.isEmpty else { throw TicketPassError.imageUnavailable }
            guard isShowingTicketDetail, detailTicketID == ticket.id else { return }
            passesForSheet = passes
            isShowingPassSheet = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func readPhotoPickerItems(_ items: [PhotosPickerItem], ticketID: String?) async {
        isReadingScreenshot = true
        scanMessage = nil
        errorMessage = nil
        defer {
            isReadingScreenshot = false
            if ticketID == nil { photoItems = [] }
            else { additionalPhotoItems = [] }
        }
        var messages: [String] = []
        var failures: [String] = []
        for (index, item) in items.enumerated() {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    throw TicketPassError.imageUnavailable
                }
                guard data.count <= 12 * 1024 * 1024 else { throw TicketPassError.imageTooLarge }
                messages.append(contentsOf: try await decodeQrMessages(from: data))
            } catch {
                failures.append("Screenshot \(index + 1): \(error.localizedDescription)")
            }
        }
        await acceptScannedQrMessages(messages, failures: failures, ticketID: ticketID)
    }

    private func readImportedFiles(_ result: Result<[URL], Error>, ticketID: String?) async {
        isReadingScreenshot = true
        scanMessage = nil
        errorMessage = nil
        defer { isReadingScreenshot = false }
        do {
            let files = try result.get()
            guard !files.isEmpty else { return }
            var messages: [String] = []
            var failures: [String] = []
            for (index, url) in files.enumerated() {
                do {
                    let canRead = url.startAccessingSecurityScopedResource()
                    defer { if canRead { url.stopAccessingSecurityScopedResource() } }
                    let fileSize = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
                    guard let fileSize, fileSize <= 12 * 1024 * 1024 else {
                        throw TicketPassError.imageTooLarge
                    }
                    let data = try Data(contentsOf: url, options: [.mappedIfSafe])
                    guard data.count <= 12 * 1024 * 1024 else { throw TicketPassError.imageTooLarge }
                    messages.append(contentsOf: try await decodeQrMessages(from: data))
                } catch {
                    failures.append("Screenshot \(index + 1): \(error.localizedDescription)")
                }
            }
            await acceptScannedQrMessages(messages, failures: failures, ticketID: ticketID)
        } catch {
            scanMessage = "\(error.localizedDescription) Retry with a clearer screenshot or use the original ticket."
        }
    }

    private func acceptScannedQrMessages(
        _ messages: [String],
        failures: [String],
        ticketID: String?
    ) async {
        var seen = Set<Data>()
        let uniqueMessages = messages.filter { seen.insert(Data($0.utf8)).inserted }
        var accepted: [String] = []
        var notices = failures

        if let ticketID {
            guard let ticket = selectedTicket, ticket.id == ticketID else {
                scanMessage = "The selected booking changed. Open it again and retry adding the screenshots."
                return
            }
            let existingMessages = Set(ticket.qrCodes.map { Data($0.qrMessage.utf8) })
            let pendingMessages = pendingAdditionalTicketID == ticketID ? pendingAdditionalQrMessages : []
            let knownMessages = existingMessages.union(pendingMessages.map { Data($0.utf8) })
            let newMessages = uniqueMessages.filter { !knownMessages.contains(Data($0.utf8)) }
            let available = max(0, 10 - ticket.qrCodes.count - pendingMessages.count)
            accepted = Array(newMessages.prefix(available))
            if newMessages.count > accepted.count {
                notices.append("A booking can contain up to 10 ticket QR codes. Extra codes were left out.")
            }
            if !accepted.isEmpty {
                pendingAdditionalTicketID = ticketID
                pendingAdditionalQrMessages = pendingMessages + accepted
                await savePendingAdditionalQrCodes(for: ticketID)
            } else if newMessages.isEmpty && uniqueMessages.isEmpty && notices.isEmpty {
                notices.append("No readable QR code was found. Retry with a clearer screenshot or use the original ticket.")
            } else if newMessages.isEmpty && !uniqueMessages.isEmpty {
                statusMessage = "Those QR codes are already in this booking."
            }
        } else {
            let knownMessages = Set(qrMessages.map { Data($0.utf8) })
            let newMessages = uniqueMessages.filter { !knownMessages.contains(Data($0.utf8)) }
            let available = max(0, 10 - qrMessages.count)
            accepted = Array(newMessages.prefix(available))
            qrMessages.append(contentsOf: accepted)
            if newMessages.count > accepted.count {
                notices.append("A booking can contain up to 10 ticket QR codes. Extra codes were left out.")
            }
            if accepted.isEmpty && uniqueMessages.isEmpty && notices.isEmpty {
                notices.append("No readable QR code was found. Retry with a clearer screenshot or use the original ticket.")
            } else if accepted.isEmpty && !uniqueMessages.isEmpty {
                statusMessage = "Those QR codes are already selected."
            }
        }

        if !accepted.isEmpty {
            scanMessage = "\(accepted.count) ticket QR code\(accepted.count == 1 ? "" : "s") read on this iPhone. Screenshots were not uploaded or saved."
        }
        if !notices.isEmpty {
            scanMessage = ([scanMessage].compactMap { $0 } + notices).joined(separator: " ")
        }
    }

    private func savePendingAdditionalQrCodes(for ticketID: String) async {
        guard pendingAdditionalTicketID == ticketID,
              !pendingAdditionalQrMessages.isEmpty,
              let accountID = account.identity?.id else { return }
        isAppendingQrCodes = true
        defer { isAppendingQrCodes = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["qrMessages": pendingAdditionalQrMessages])
            let page: WalletTicketDetailPage = try await account.requestPrivate(
                path: "/api/v1/ticket-passes/\(ticketID)/qr-codes",
                method: "POST",
                body: body,
                as: WalletTicketDetailPage.self
            )
            guard selectedTicket?.id == ticketID else { return }
            selectedTicket = page.ticket
            pendingAdditionalTicketID = nil
            pendingAdditionalQrMessages = []
            statusMessage = "Ticket QR codes added to this booking."
            scanMessage = nil
            await WalletTicketOfflineCache.shared.storeDetail(page.ticket, accountID: accountID)
            await loadTicketListOnly()
        } catch {
            errorMessage = "QR codes were read but could not be saved. Tap Retry saving QR codes, or keep the original ticket available. \(error.localizedDescription)"
        }
    }

    private func decodeQrMessages(from data: Data) async throws -> [String] {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[String], Error>) in
            DispatchQueue.global(qos: .userInitiated).async {
                guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
                    continuation.resume(throwing: TicketPassError.imageUnavailable)
                    return
                }
                let thumbnailOptions: [CFString: Any] = [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceThumbnailMaxPixelSize: 2_600,
                    kCGImageSourceShouldCacheImmediately: true
                ]
                guard let image = CGImageSourceCreateThumbnailAtIndex(
                    source,
                    0,
                    thumbnailOptions as CFDictionary
                ) else {
                    continuation.resume(throwing: TicketPassError.imageUnavailable)
                    return
                }
                let request = VNDetectBarcodesRequest()
                request.symbologies = [.qr]
                do {
                    try VNImageRequestHandler(cgImage: image).perform([request])
                    let observations = request.results ?? []
                    guard !observations.isEmpty else {
                        continuation.resume(throwing: TicketPassError.qrNotFound)
                        return
                    }
                    var messages: [String] = []
                    var seen = Set<Data>()
                    for observation in observations {
                        guard let descriptor = observation.barcodeDescriptor as? CIQRCodeDescriptor,
                              let code = TicketQRPayload.validatedText(
                                  observation.payloadStringValue,
                                  codewords: descriptor.errorCorrectedPayload,
                                  version: descriptor.symbolVersion
                              ) else {
                            continuation.resume(throwing: TicketPassError.qrPayloadUnsupported)
                            return
                        }
                        guard code.utf8.count <= 2048 else {
                            continuation.resume(throwing: TicketPassError.qrPayloadTooLarge)
                            return
                        }
                        if seen.insert(Data(code.utf8)).inserted { messages.append(code) }
                        if messages.count > 10 {
                            continuation.resume(throwing: TicketPassError.tooManyQRCodes)
                            return
                        }
                    }
                    continuation.resume(returning: messages)
                } catch {
                    continuation.resume(throwing: TicketPassError.qrReadFailed)
                }
            }
        }
    }

    private func apply(_ suggestion: WalletTicketScreening) {
        guard !hasInteractedWithScreening else { return }
        form = suggestion
        hasConfirmedShowDate = true
        hasConfirmedShowTime = true
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = jerusalemCalendar
        formatter.timeZone = jerusalemTimeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = jerusalemCalendar
        formatter.timeZone = jerusalemTimeZone
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    private func parseScreeningDate(_ value: String) -> Date? {
        guard !value.isEmpty else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = jerusalemCalendar
        formatter.timeZone = jerusalemTimeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: value)
    }

    private func parseScreeningTime(_ value: String) -> Date? {
        guard !value.isEmpty else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = jerusalemCalendar
        formatter.timeZone = jerusalemTimeZone
        formatter.dateFormat = "HH:mm"
        return formatter.date(from: value)
    }

    private func displayDate(_ value: String) -> String {
        guard let date = parseScreeningDate(value) else { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.calendar = jerusalemCalendar
        formatter.timeZone = jerusalemTimeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    private var emptyForm: WalletTicketScreening {
        WalletTicketScreening(
            tmdbId: nil,
            title: "",
            city: account.preferences.location,
            cinema: "",
            screeningDate: formatDate(.now),
            screeningTime: formatTime(.now)
        )
    }

    private enum TicketPassError: LocalizedError {
        case imageUnavailable
        case imageTooLarge
        case qrPayloadUnsupported
        case qrPayloadTooLarge
        case qrNotFound
        case tooManyQRCodes
        case qrReadFailed
        case walletUnavailable

        var errorDescription: String? {
            switch self {
            case .imageUnavailable: "This image could not be opened."
            case .imageTooLarge: "Choose an image smaller than 12 MB."
            case .qrPayloadUnsupported: "This QR code uses a text encoding Kartiseret cannot preserve on a Wallet pass. Use the original ticket instead."
            case .qrPayloadTooLarge: "This QR code contains more data than Kartiseret can safely put on a Wallet pass. Use the original ticket instead."
            case .qrNotFound: "No readable QR code was found."
            case .tooManyQRCodes: "More than 10 ticket QR codes were found. Choose fewer screenshots or split this booking."
            case .qrReadFailed: "The QR code could not be read."
            case .walletUnavailable: "Apple Wallet is unavailable on this device. Your QR remains in Kartiseret."
            }
        }
    }
}

private struct SavedTicketQRCode: View {
    let message: String
    let label: String
    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .renderingMode(.original)
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
                    .frame(maxWidth: 300)
                    .accessibilityLabel(label)
            } else if failed {
                Text("This QR could not be rendered. Use the original cinema ticket.")
                    .foregroundStyle(.orange)
            } else {
                ProgressView("Preparing QR code…")
            }
        }
        .frame(maxWidth: .infinity)
        .task(id: Data(message.utf8)) {
            image = TicketQRCodeRenderer.makeBitmap(message).map { UIImage(cgImage: $0) }
            failed = image == nil
        }
    }
}

enum TicketQRCodeRenderer {
    private static let context = CIContext()

    static func makeBitmap(_ message: String) -> CGImage? {
        guard !message.isEmpty else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(message.utf8)
        filter.correctionLevel = "M"
        guard let modules = filter.outputImage, !modules.extent.isEmpty else { return nil }
        // Include four white modules around the code for scanner detection.
        let extent = modules.extent.insetBy(dx: -4, dy: -4)
        let white = CIImage(color: .white).cropped(to: extent)
        let scale = CGAffineTransform(scaleX: 8, y: 8)
        let output = modules.composited(over: white).transformed(by: scale)
        return context.createCGImage(output, from: extent.applying(scale))
    }
}

private struct AddWalletPassSheet: UIViewControllerRepresentable {
    let passes: [PKPass]

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> UIViewController {
        guard let controller = PKAddPassesViewController(passes: passes) else {
            return UIViewController()
        }
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: UIViewController, context: Context) {}

    final class Coordinator: NSObject, PKAddPassesViewControllerDelegate {
        func addPassesViewControllerDidFinish(_ controller: PKAddPassesViewController) {
            MainActor.assumeIsolated {
                controller.dismiss(animated: true)
            }
        }
    }
}
