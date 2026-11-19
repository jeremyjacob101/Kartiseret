import AuthenticationServices
import CryptoKit
import GoogleSignIn
import GoogleSignInSwift
import SwiftUI

struct YouView: View {
    @Environment(AccountStore.self) private var account
    @Environment(AppStore.self) private var app

    var body: some View {
        List {
            if account.state == .restoring {
                Section { ProgressView("Restoring your account…") }
            } else if account.state == .signedIn, let identity = account.identity {
                Section("Account") {
                    Label(identity.email ?? "Kartiseret account", systemImage: "person.crop.circle.fill")
                    settingsLink("Preferences", systemImage: "slider.horizontal.3") {
                        PreferencesView()
                    }
                }
                Section("Support") {
                    settingsLink("Help and privacy", systemImage: "questionmark.circle") { HelpView() }
                        .accessibilityIdentifier("account.help")
                }
                Section {
                    Button("Sign Out", role: .destructive) {
                        GIDSignIn.sharedInstance.signOut()
                        Task { await account.signOut() }
                    }
                }
            } else {
                Section {
                    Text("Find what’s playing, save your settings, and keep track of films you’re waiting for.")
                        .foregroundStyle(.secondary)
                    NavigationLink {
                        SignInView()
                    } label: {
                        Label("Sign in or create account", systemImage: "person.crop.circle.badge.checkmark")
                    }
                    .accessibilityIdentifier("account.signIn")
                    if account.appleSignInAvailable { SignInWithAppleControl() }
                    if account.googleSignInAvailable { GoogleSignInControl() }
                } header: {
                    Text("Your Kartiseret")
                } footer: {
                    Text("Browsing showtimes and opening ticket links are available without an account.")
                }
                if case .unavailable(let message) = account.state {
                    Section {
                        Text(message).foregroundStyle(.orange)
                        Button("Try again") { Task { await account.restore(fallbackLocation: app.selectedCity) } }
                    }
                }
                Section("On this device") {
                    settingsLink("Help and privacy", systemImage: "questionmark.circle") { HelpView() }
                        .accessibilityIdentifier("account.help")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("You")
        .navigationBarTitleDisplayMode(.large)
        .tint(Color(hexString: account.preferences.siteColor) ?? BrandStyle.accent)
    }

    private func settingsLink<Destination: View>(
        _ title: String,
        systemImage: String,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        NavigationLink(destination: destination()) {
            Label(title, systemImage: systemImage)
        }
    }
}

struct SignInView: View {
    @Environment(AccountStore.self) private var account
    @Environment(AppStore.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var creatingAccount = false
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var pending = false

    var body: some View {
        Form {
            Section {
                if creatingAccount {
                    TextField("Name", text: $name)
                        .textContentType(.name)
                        .textInputAutocapitalization(.words)
                }
                TextField("Email", text: $email)
                    .textContentType(.emailAddress)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("auth.email")
                SecureField("Password", text: $password)
                    .textContentType(creatingAccount ? .newPassword : .password)
                    .accessibilityIdentifier("auth.password")
                if creatingAccount {
                    Text("Password must be at least 8 characters.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Link("Forgot password?", destination: URL(string: "https://seret.site/reset-password")!)
                }
                if let message = account.feedback {
                    Text(message).font(.callout).foregroundStyle(.secondary)
                }
                if let error {
                    Text(error).font(.callout).foregroundStyle(.red)
                }
                Button {
                    Task { await submit() }
                } label: {
                    if pending { ProgressView() }
                    else { Text(creatingAccount ? "Create account" : "Sign in") }
                }
                .disabled(pending || email.isEmpty || password.isEmpty || (creatingAccount && name.isEmpty))
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("auth.submit")
            } header: {
                Text(creatingAccount ? "Create your account" : "Sign in")
            } footer: {
                Text("Your password is sent only to Kartiseret’s secure sign-in service.")
            }

            Section {
                if account.appleSignInAvailable { SignInWithAppleControl() }
                if account.googleSignInAvailable { GoogleSignInControl() }
                Button(creatingAccount ? "Already have an account? Sign in" : "New to Kartiseret? Create an account") {
                    creatingAccount.toggle()
                    error = nil
                }
                .frame(maxWidth: .infinity)
            }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle(creatingAccount ? "Create Account" : "Sign In")
        .navigationBarTitleDisplayMode(.inline)
        .tint(BrandStyle.accent)
        .onChange(of: account.state) { _, state in
            if state == .signedIn { dismiss() }
        }
    }

    @MainActor private func submit() async {
        pending = true
        error = nil
        defer { pending = false }
        do {
            if creatingAccount {
                _ = try await account.signUp(name: name, email: email, password: password, fallbackLocation: app.selectedCity)
            } else {
                try await account.signIn(email: email, password: password, fallbackLocation: app.selectedCity)
                dismiss()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct GoogleSignInControl: View {
    @Environment(AccountStore.self) private var account
    @Environment(AppStore.self) private var app
    @State private var pending = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 8) {
            GoogleSignInButton(action: beginSignIn)
                .frame(height: 48)
                .disabled(pending)
                .accessibilityIdentifier("auth.google")
            if pending { ProgressView("Signing in with Google…") }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }
    }

    @MainActor private func beginSignIn() {
        guard let clientID = AppConfiguration.googleIOSClientID,
              let serverClientID = AppConfiguration.googleServerClientID,
              let presenter = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows)
                .first(where: \.isKeyWindow)?.rootViewController else {
            error = "Google sign-in is not configured for this app build."
            return
        }

        error = nil
        pending = true
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: clientID,
            serverClientID: serverClientID
        )
        GIDSignIn.sharedInstance.signIn(withPresenting: presenter) { result, signInError in
            let errorMessage = signInError?.localizedDescription
            let identityToken = result?.user.idToken?.tokenString
            let accessToken = result?.user.accessToken.tokenString
            Task { @MainActor in
                defer { pending = false }
                if let errorMessage {
                    error = errorMessage
                    return
                }
                guard let identityToken, let accessToken else {
                    error = "Google did not return a sign-in token. Try again."
                    return
                }
                do {
                    try await account.signInWithGoogle(
                        identityToken: identityToken,
                        accessToken: accessToken,
                        fallbackLocation: app.selectedCity
                    )
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

private struct SignInWithAppleControl: View {
    @Environment(AccountStore.self) private var account
    @Environment(AppStore.self) private var app
    @State private var rawNonce: String?
    @State private var error: String?

    var body: some View {
        VStack(spacing: 8) {
            SignInWithAppleButton(.signIn) { request in
                let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString
                rawNonce = nonce
                request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
                request.requestedScopes = [.email, .fullName]
            } onCompletion: { result in
                guard case .success(let authorization) = result,
                      let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                      let tokenData = credential.identityToken,
                      let identityToken = String(data: tokenData, encoding: .utf8),
                      let nonce = rawNonce else {
                    if case .failure(let failure) = result { error = failure.localizedDescription }
                    return
                }
                Task {
                    do { try await account.signInWithApple(identityToken: identityToken, nonce: nonce, fallbackLocation: app.selectedCity) }
                    catch { self.error = error.localizedDescription }
                }
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .accessibilityIdentifier("auth.apple")
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }
    }
}

struct ShowtimePreferencesView: View {
    @Environment(AccountStore.self) private var account
    @Environment(AppStore.self) private var app
    @Environment(\.dismiss) private var dismiss

    private let groups: [(String, [String])] = [
        ("Show type", ShowtimeLogic.filterOptions["showType"] ?? []),
        ("Screen format", ShowtimeLogic.filterOptions["screenFormat"] ?? []),
        ("Technology", ShowtimeLogic.filterOptions["screeningTech"] ?? []),
        ("Language", ShowtimeLogic.filterOptions["dubLanguage"] ?? []),
    ]

    private var cinemas: [CinemaIdentity] {
        CinemaIdentity.all.filter { CinemaIdentity.normalized($0.city) == CinemaIdentity.normalized(app.selectedCity) }
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }

    var body: some View {
        Form {
            ForEach(groups, id: \.0) { title, options in
                Section(title) {
                    ForEach(options, id: \.self) { option in
                        Toggle(option, isOn: selection(for: title, option: option))
                    }
                }
            }
            if !cinemas.isEmpty {
                Section("\(app.selectedCity) cinemas") {
                    ForEach(cinemas) { cinema in
                        Toggle(cinema.displayName, isOn: cinemaSelection(cinema.id))
                    }
                }
            }
            Section {
                Button("Show everything") {
                    var value = account.preferences.showtimePreferences
                    value.screeningFilters.unchecked = .init()
                    value.excludedCinemaIds = []
                    Task { await account.saveShowtimePreferences(value) }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("Showtime filters")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private func selection(for title: String, option: String) -> Binding<Bool> {
        Binding(
            get: { !unchecked(in: account.preferences.showtimePreferences, group: title).contains(option) },
            set: { selected in
                var value = account.preferences.showtimePreferences
                var values = unchecked(in: value, group: title)
                if selected { values.removeAll { $0 == option } }
                else if !values.contains(option) { values.append(option) }
                setUnchecked(values.sorted(), in: &value, group: title)
                Task { await account.saveShowtimePreferences(value) }
            }
        )
    }

    private func unchecked(in value: AccountPreferences.Showtime, group: String) -> [String] {
        switch group {
        case "Show type": value.screeningFilters.unchecked.showType
        case "Screen format": value.screeningFilters.unchecked.screenFormat
        case "Technology": value.screeningFilters.unchecked.screeningTech
        default: value.screeningFilters.unchecked.dubLanguage
        }
    }

    private func setUnchecked(_ values: [String], in value: inout AccountPreferences.Showtime, group: String) {
        switch group {
        case "Show type": value.screeningFilters.unchecked.showType = values
        case "Screen format": value.screeningFilters.unchecked.screenFormat = values
        case "Technology": value.screeningFilters.unchecked.screeningTech = values
        default: value.screeningFilters.unchecked.dubLanguage = values
        }
    }

    private func cinemaSelection(_ cinemaID: String) -> Binding<Bool> {
        Binding(
            get: { !account.preferences.showtimePreferences.excludedCinemaIds.contains(cinemaID) },
            set: { included in
                var value = account.preferences.showtimePreferences
                if included { value.excludedCinemaIds.removeAll { $0 == cinemaID } }
                else if !value.excludedCinemaIds.contains(cinemaID) { value.excludedCinemaIds.append(cinemaID) }
                value.excludedCinemaIds.sort()
                Task { await account.saveShowtimePreferences(value) }
            }
        )
    }
}

extension Color {
    init?(hexString: String) {
        let value = hexString.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard value.count == 6, let number = UInt(value, radix: 16) else { return nil }
        self.init(.sRGB, red: Double((number >> 16) & 0xff) / 255, green: Double((number >> 8) & 0xff) / 255, blue: Double(number & 0xff) / 255, opacity: 1)
    }
}

struct DeleteAccountView: View {
    @Environment(AccountStore.self) private var account
    @State private var confirmation = ""
    @State private var pending = false
    @State private var sent = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PreferenceSurface {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text("Delete account")
                            .font(.headline)
                            .foregroundStyle(.red)
                    }

                    Text("Permanently delete your account and account-linked data stored by Kartiseret. This cannot be undone. Backup copies may remain until those backups expire.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    if let email = account.identity?.email {
                        Label(email, systemImage: "person.crop.circle")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.82))
                            .textSelection(.enabled)
                    }
                }
            }

            if sent {
                PreferenceSurface {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Check your email", systemImage: "envelope.badge")
                            .font(.headline)
                            .foregroundStyle(.green)
                        Text("Open the confirmation link in your email to return to Kartiseret and review deletion. Your account has not been deleted yet.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                PreferenceSurface {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Type DELETE to continue")
                            .font(.subheadline.weight(.semibold))
                        TextField("DELETE", text: $confirmation)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .padding(.horizontal, 12)
                            .padding(.vertical, 11)
                            .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                            .accessibilityIdentifier("account.delete.confirmation")

                        Button(role: .destructive) {
                            Task { await requestDeletion() }
                        } label: {
                            if pending { ProgressView("Sending email…") }
                            else { Label("Email me a confirmation link", systemImage: "envelope") }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                        .disabled(pending || confirmation != "DELETE" || account.state != .signedIn)
                        .accessibilityIdentifier("account.delete.submit")
                    }
                }
            }

            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
    }

    @MainActor private func requestDeletion() async {
        pending = true
        error = nil
        defer { pending = false }
        do {
            try await account.requestAccountDeletion()
            sent = true
            confirmation = ""
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ConfirmAccountDeletionView: View {
    let token: String
    @Environment(AccountStore.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var pending = false
    @State private var deleted = false
    @State private var error: String?

    var body: some View {
        Form {
            if deleted {
                Section {
                    Label("Account deleted", systemImage: "checkmark.circle")
                    Text("Your account and account-linked data have been deleted.")
                    Button("Done") { dismiss() }
                }
            } else {
                Section {
                    Text("This permanently deletes your Kartiseret account and account-linked data. This cannot be undone. Opening this link has not deleted anything.")
                    if account.state == .signedIn {
                        Text(account.identity?.email ?? "Kartiseret account")
                        Button("Confirm and delete account", role: .destructive) {
                            Task { await confirm() }
                        }
                        .disabled(pending)
                        .accessibilityIdentifier("account.delete.finalConfirmation")
                    } else {
                        Text("Sign in to the account that requested deletion, then return to this screen to confirm.")
                        NavigationLink("Sign in") { SignInView() }
                    }
                    if pending { ProgressView("Deleting account…") }
                    if let error { Text(error).foregroundStyle(.red) }
                }
            }
        }
        .navigationTitle("Confirm deletion")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(pending) } }
        .interactiveDismissDisabled(pending)
    }

    @MainActor private func confirm() async {
        pending = true
        error = nil
        defer { pending = false }
        do {
            try await account.confirmAccountDeletion(confirmationToken: token)
            GIDSignIn.sharedInstance.signOut()
            deleted = true
        } catch {
            self.error = "Deletion could not be completed. Check that you’re signed in to the account that requested it. If the link expired, request a new one."
        }
    }
}
