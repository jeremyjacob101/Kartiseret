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
    @State private var qrMessage = ""
    @State private var photoItem: PhotosPickerItem?
    @State private var isLoading = true
    @State private var isReadingScreenshot = false
    @State private var isSaving = false
    @State private var isPreparingPass = false
    @State private var isShowingPassSheet = false
    @State private var passForSheet: PKPass?
    @State private var isShowingDeleteConfirmation = false
    @State private var isShowingReminderSettings = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var scanMessage: String?
    @State private var hasInteractedWithScreening = false
    @State private var hasConfirmedShowDate = false
    @State private var hasConfirmedShowTime = false

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
                if account.state == .signedIn {
                    importSection
                    screeningSection
                } else {
                    Section {
                        Text("You’re offline. Tickets saved on this iPhone are available below; connect to import, edit, or sync tickets.")
                            .foregroundStyle(.secondary)
                    }
                }
                savedTicketsSection
                if let selectedTicket { selectedTicketSection(selectedTicket) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("My Tickets")
        .navigationBarTitleDisplayMode(.inline)
        .tint(Color(hexString: account.preferences.siteColor) ?? BrandStyle.accent)
        .task { await loadTickets() }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await readPhotoPickerItem(item) }
        }
        .fileImporter(
            isPresented: Binding(get: { isImportingScreenshot }, set: { isImportingScreenshot = $0 }),
            allowedContentTypes: [.image],
            allowsMultipleSelection: false
        ) { result in
            Task { await readImportedFile(result) }
        }
        .sheet(isPresented: $isShowingPassSheet, onDismiss: { passForSheet = nil }) {
            if let passForSheet { AddWalletPassSheet(pass: passForSheet) }
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
            if isReadingScreenshot { ProgressView("Reading QR code on this iPhone…") }
            PhotosPicker(selection: $photoItem, matching: .images) {
                Label("Choose screenshot from Photos", systemImage: "qrcode.viewfinder")
            }
            .disabled(isReadingScreenshot || isSaving)
            Button {
                isImportingScreenshot = true
            } label: {
                Label("Choose screenshot from Files", systemImage: "folder")
            }
            .disabled(isReadingScreenshot || isSaving)
            Text("QR reading happens on this iPhone. The screenshot is not uploaded or saved. Printed showtime details are not read automatically; review them below.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if !qrMessage.isEmpty {
                Label("QR code ready", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("The QR contents are stored privately with this ticket so the pass can be recreated.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let scanMessage {
                Text(scanMessage).font(.footnote).foregroundStyle(.orange)
            }
        } header: {
            Text(editingTicketID == nil ? "Import ticket" : "Replace QR code")
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
                        selectedTicket = nil
                        if editingTicketID != nil {
                            cancelEditing()
                        }
                        Task { await loadTicket(ticket.id) }
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
            if let image = qrImage(for: ticket.qrMessage) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 270)
                    .padding(14)
                    .background(.white, in: RoundedRectangle(cornerRadius: 14))
                    .frame(maxWidth: .infinity)
                    .accessibilityLabel("Ticket QR code")
            } else {
                Text("This QR could not be rendered. Re-import the screenshot or use the original cinema ticket.")
                    .foregroundStyle(.orange)
            }
            Text("If Apple Wallet is unavailable, show this QR in Kartiseret or use the original ticket from the cinema.")
                .font(.footnote).foregroundStyle(.secondary)
            Button {
                Task { await addOrUpdateWalletPass(ticket) }
            } label: {
                if isPreparingPass { ProgressView() }
                else { Label("Add or Update in Apple Wallet", systemImage: "wallet.pass") }
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
                Text("A notification opens this ticket in Kartiseret. Apple Wallet may also show its pass when relevant.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            HStack {
                Button("Edit details") { beginEditing(ticket) }
                Spacer()
                Button("Delete ticket", role: .destructive) { isShowingDeleteConfirmation = true }
            }
        } header: {
            Text(ticket.title)
        } footer: {
            Text("\(ticket.cinema), \(ticket.city) · \(displayDate(ticket.screeningDate)) at \(ticket.screeningTime)")
        }
    }

    private var isValidForm: Bool {
        !qrMessage.isEmpty &&
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
            if let initialTicketID, !initialTicketID.isEmpty {
                await loadTicket(initialTicketID)
            }
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
        if let initialTicketID, !initialTicketID.isEmpty {
            await loadTicket(initialTicketID)
        } else if loadedFromServer,
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

    private func loadTicket(_ id: String) async {
        guard let accountID = account.identity?.id else { return }
        if let cachedTicket = await WalletTicketOfflineCache.shared.loadDetail(
            ticketID: id,
            accountID: accountID
           ) {
            selectedTicket = cachedTicket
            statusMessage = "Showing the copy saved on this iPhone while the ticket refreshes."
        }
        guard account.state == .signedIn else {
            if selectedTicket == nil {
                errorMessage = "This ticket has not been opened on this iPhone yet. Connect to load its QR code."
            }
            return
        }
        do {
            let page: WalletTicketDetailPage = try await account.requestPrivate(
                path: "/api/v1/ticket-passes/\(id)",
                method: "GET",
                as: WalletTicketDetailPage.self
            )
            selectedTicket = page.ticket
            await WalletTicketOfflineCache.shared.storeDetail(page.ticket, accountID: accountID)
            errorMessage = nil
            statusMessage = nil
        } catch {
            if let cachedTicket = await WalletTicketOfflineCache.shared.loadDetail(
                ticketID: id,
                accountID: accountID
               ) {
                selectedTicket = cachedTicket
                statusMessage = "Offline copy shown. Check the cinema’s original ticket for the latest status."
                errorMessage = nil
            } else {
                selectedTicket = nil
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
                "qrMessage": qrMessage,
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
            }
            let body = try JSONSerialization.data(withJSONObject: payload)
            let saved: WalletTicketChangePage = try await account.requestPrivate(
                path: path,
                method: method,
                body: body,
                as: WalletTicketChangePage.self
            )
            if let editingTicketID { await TicketReminderManager.cancel(ticketID: editingTicketID) }
            let savedID = editingTicketID ?? ""
            if isEditing, !savedID.isEmpty {
                await loadTicket(savedID)
                statusMessage = "Ticket updated. Select Update in Apple Wallet to replace the pass."
            } else {
                await loadTicket(saved.ticket.id)
                statusMessage = "Ticket saved to your Kartiseret account."
            }
            editingTicketID = nil
            form = emptyForm
            qrMessage = ""
            hasInteractedWithScreening = false
            hasConfirmedShowDate = false
            hasConfirmedShowTime = false
            await loadTicketListOnly()
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
            selectedTicket = nil
            editingTicketID = nil
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
        qrMessage = ticket.qrMessage
        hasInteractedWithScreening = true
        hasConfirmedShowDate = true
        hasConfirmedShowTime = true
        statusMessage = nil
        errorMessage = nil
    }

    private func cancelEditing() {
        editingTicketID = nil
        qrMessage = ""
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
            let data = try await account.requestPrivateFile(
                path: "/api/v1/ticket-passes/\(ticket.id)/pass.pkpass",
                contentType: "application/vnd.apple.pkpass"
            )
            let pass = try PKPass(data: data)
            let library = PKPassLibrary()
            if library.containsPass(pass) {
                guard library.replacePass(with: pass) else {
                    throw TicketPassError.walletUpdateFailed
                }
                statusMessage = "Pass updated in Apple Wallet."
            } else {
                guard PKAddPassesViewController.canAddPasses() else {
                    throw TicketPassError.walletUnavailable
                }
                passForSheet = pass
                isShowingPassSheet = true
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func readPhotoPickerItem(_ item: PhotosPickerItem) async {
        isReadingScreenshot = true
        scanMessage = nil
        errorMessage = nil
        defer { isReadingScreenshot = false; photoItem = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                throw TicketPassError.imageUnavailable
            }
            guard data.count <= 12 * 1024 * 1024 else { throw TicketPassError.imageTooLarge }
            qrMessage = try await decodeQrMessage(from: data)
            scanMessage = "QR code read on this iPhone. The screenshot was not uploaded or saved."
        } catch {
            qrMessage = ""
            scanMessage = "\(error.localizedDescription) Retry with a clearer screenshot or use the original ticket."
        }
    }

    private func readImportedFile(_ result: Result<[URL], Error>) async {
        isReadingScreenshot = true
        scanMessage = nil
        errorMessage = nil
        defer { isReadingScreenshot = false }
        do {
            guard let url = try result.get().first else { throw TicketPassError.imageUnavailable }
            let canRead = url.startAccessingSecurityScopedResource()
            defer { if canRead { url.stopAccessingSecurityScopedResource() } }
            let fileSize = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize
            guard let fileSize, fileSize <= 12 * 1024 * 1024 else {
                throw TicketPassError.imageTooLarge
            }
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            guard data.count <= 12 * 1024 * 1024 else { throw TicketPassError.imageTooLarge }
            qrMessage = try await decodeQrMessage(from: data)
            scanMessage = "QR code read on this iPhone. The screenshot was not uploaded or saved."
        } catch {
            qrMessage = ""
            scanMessage = "\(error.localizedDescription) Retry with a clearer screenshot or use the original ticket."
        }
    }

    private func decodeQrMessage(from data: Data) async throws -> String {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
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
                    guard observations.count == 1, let observation = observations.first else {
                        continuation.resume(throwing: observations.isEmpty ? TicketPassError.qrNotFound : TicketPassError.multipleQRCodes)
                        return
                    }
                    guard let code = observation.payloadStringValue,
                          let payloadData = observation.payloadData,
                          Data(code.utf8) == payloadData,
                          !code.isEmpty else {
                        continuation.resume(throwing: TicketPassError.qrPayloadUnsupported)
                        return
                    }
                    guard code.utf8.count <= 2048 else {
                        continuation.resume(throwing: TicketPassError.qrPayloadTooLarge)
                        return
                    }
                    continuation.resume(returning: code)
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

    private func qrImage(for message: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(message.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 9, y: 9)) else { return nil }
        return UIImage(ciImage: output)
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
        case multipleQRCodes
        case qrReadFailed
        case walletUnavailable
        case walletUpdateFailed

        var errorDescription: String? {
            switch self {
            case .imageUnavailable: "This image could not be opened."
            case .imageTooLarge: "Choose an image smaller than 12 MB."
            case .qrPayloadUnsupported: "This QR code uses a text encoding Kartiseret cannot preserve on a Wallet pass. Use the original ticket instead."
            case .qrPayloadTooLarge: "This QR code contains more data than Kartiseret can safely put on a Wallet pass. Use the original ticket instead."
            case .qrNotFound: "No readable QR code was found."
            case .multipleQRCodes: "More than one QR code was found. Choose a screenshot with one ticket QR."
            case .qrReadFailed: "The QR code could not be read."
            case .walletUnavailable: "Apple Wallet is unavailable on this device. Your QR remains in Kartiseret."
            case .walletUpdateFailed: "The Wallet pass could not be replaced. Check the original ticket in Kartiseret."
            }
        }
    }
}

private struct AddWalletPassSheet: UIViewControllerRepresentable {
    let pass: PKPass

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> UIViewController {
        guard let controller = PKAddPassesViewController(pass: pass) else {
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
