import SwiftUI

private enum TicketAlertFilterGroup: String, CaseIterable, Identifiable {
    case showType
    case screenFormat
    case screeningTech
    case dubLanguage

    var id: Self { self }
    var title: String {
        switch self {
        case .showType: "Show type"
        case .screenFormat: "Screen format"
        case .screeningTech: "Screening technology"
        case .dubLanguage: "Language"
        }
    }

    var options: [String] { ShowtimeLogic.filterOptions[rawValue] ?? [] }
}

struct TicketAlertPreferencesView: View {
    @Environment(AccountStore.self) private var account
    @Environment(AppStore.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var preferences = TicketAlertPreferences()
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var error: String?
    @State private var baseline = TicketAlertPreferences()

    var body: some View {
        Form {
            Section {
                Toggle("Use my preferred city", isOn: Binding(
                    get: { preferences.cities == nil },
                    set: { usePreferred in
                        if usePreferred { preferences.cities = nil }
                        else { preferences.cities = [app.selectedCity] }
                    }
                ))
                if preferences.cities != nil {
                    ForEach(app.cities) { city in
                        Toggle(city.name, isOn: citySelection(city.name))
                    }
                    if preferences.cities?.isEmpty == true {
                        Text("No cities selected means no alerts will be sent.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("Alert cities")
            } footer: {
                Text("Alerts use your preferred city by default. Choose several cities to watch a wider area.")
            }

            Section("When to notify") {
                Picker("Notification timing", selection: $preferences.notificationMode) {
                    Text("First in any city").tag("first_any_city")
                    Text("First in each city").tag("first_per_city")
                }
                Text(preferences.notificationMode == "first_per_city"
                     ? "Get one alert for this film in each selected city."
                     : "Get one alert when the film first becomes available in any selected city.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            ForEach(TicketAlertFilterGroup.allCases) { group in
                Section(group.title) {
                    ForEach(group.options, id: \.self) { option in
                        Toggle(option, isOn: filterSelection(group, option: option))
                    }
                }
            }

            Section {
                Button("Include every screening") {
                    preferences.filters = .init()
                }
                Button("Discard changes", role: .cancel) {
                    preferences = baseline
                }
                .disabled(preferences == baseline)
            }
            if isLoading { Section { ProgressView("Loading alert settings…") } }
            if isSaving { Section { ProgressView("Saving alert settings…") } }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("Ticket alert settings")
        .navigationBarTitleDisplayMode(.inline)
        .tint(Color(hexString: account.preferences.siteColor) ?? BrandStyle.accent)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save() } }
                    .disabled(isLoading || isSaving || preferences == baseline)
            }
        }
        .task { await load() }
    }

    private func citySelection(_ city: String) -> Binding<Bool> {
        Binding(
            get: { preferences.cities?.contains(city) ?? false },
            set: { selected in
                var cities = preferences.cities ?? [app.selectedCity]
                if selected {
                    if !cities.contains(city) { cities.append(city) }
                } else {
                    cities.removeAll { $0 == city }
                }
                preferences.cities = cities.sorted()
            }
        )
    }

    private func filterSelection(_ group: TicketAlertFilterGroup, option: String) -> Binding<Bool> {
        Binding(
            get: { !unchecked(in: preferences.filters, group: group).contains(option) },
            set: { selected in
                var values = unchecked(in: preferences.filters, group: group)
                if selected { values.removeAll { $0 == option } }
                else if !values.contains(option) { values.append(option) }
                setUnchecked(values.sorted(), in: &preferences.filters, group: group)
            }
        )
    }

    private func unchecked(in value: AccountPreferences.FilterExclusions, group: TicketAlertFilterGroup) -> [String] {
        switch group {
        case .showType: value.showType
        case .screenFormat: value.screenFormat
        case .screeningTech: value.screeningTech
        case .dubLanguage: value.dubLanguage
        }
    }

    private func setUnchecked(_ values: [String], in value: inout AccountPreferences.FilterExclusions, group: TicketAlertFilterGroup) {
        switch group {
        case .showType: value.showType = values
        case .screenFormat: value.screenFormat = values
        case .screeningTech: value.screeningTech = values
        case .dubLanguage: value.dubLanguage = values
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response: TicketAlertPreferencesData = try await account.requestPrivate(path: "/api/v1/ticket-alerts/preferences", method: "GET", as: TicketAlertPreferencesData.self)
            preferences = response.preferences
            baseline = response.preferences
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            let body = try preferencesBody(preferences)
            let response: TicketAlertPreferencesData = try await account.requestPrivate(path: "/api/v1/ticket-alerts/preferences", method: "PATCH", body: body, as: TicketAlertPreferencesData.self)
            preferences = response.preferences
            baseline = response.preferences
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct TicketAlertCriteriaView: View {
    let subscription: TicketAlertSubscription
    let onSave: (TicketAlertCriteriaOverride) -> Void

    @Environment(AccountStore.self) private var account
    @Environment(AppStore.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var defaults = TicketAlertPreferences()
    @State private var draft = TicketAlertCriteriaOverride()
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var error: String?

    private var effectiveCities: [String] {
        draft.cities ?? defaults.cities ?? [app.selectedCity]
    }

    var body: some View {
        Form {
            Section("When to notify") {
                Toggle("Use account notification mode", isOn: Binding(
                    get: { draft.notificationMode == nil },
                    set: { inherited in draft.notificationMode = inherited ? nil : defaults.notificationMode }
                ))
                Picker("Notification timing", selection: Binding(
                    get: { draft.notificationMode ?? defaults.notificationMode },
                    set: { draft.notificationMode = $0 }
                )) {
                    Text("First in any city").tag("first_any_city")
                    Text("First in each city").tag("first_per_city")
                }
                .disabled(draft.notificationMode == nil || isLoading)
            }
            Section("Cities") {
                Toggle("Use account city settings", isOn: Binding(
                    get: { draft.cities == nil },
                    set: { inherited in draft.cities = inherited ? nil : effectiveCities }
                ))
                ForEach(app.cities) { city in
                    Toggle(city.name, isOn: cityOverrideSelection(city.name))
                        .disabled(draft.cities == nil || isLoading)
                }
            }
            ForEach(TicketAlertFilterGroup.allCases) { group in
                Section(group.title) {
                    Toggle("Use account filter", isOn: filterInheritanceBinding(group))
                    ForEach(group.options, id: \.self) { option in
                        Toggle(option, isOn: filterOverrideSelection(group, option: option))
                            .disabled(uncheckedOverride(in: draft.filters, group: group) == nil || isLoading)
                    }
                }
            }
            if isLoading { Section { ProgressView("Loading account defaults…") } }
            if isSaving { Section { ProgressView("Saving this film’s alert settings…") } }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("Alert settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") { Task { await save() } }
                    .disabled(isLoading || isSaving)
            }
        }
        .task { await load() }
    }

    private func cityOverrideSelection(_ city: String) -> Binding<Bool> {
        Binding(
            get: { effectiveCities.contains(city) },
            set: { selected in
                var cities = draft.cities ?? effectiveCities
                if selected { if !cities.contains(city) { cities.append(city) } }
                else { cities.removeAll { $0 == city } }
                draft.cities = cities.sorted()
            }
        )
    }

    private func filterInheritanceBinding(_ group: TicketAlertFilterGroup) -> Binding<Bool> {
        Binding(
            get: { uncheckedOverride(in: draft.filters, group: group) == nil },
            set: { inherited in
                if inherited { setUncheckedOverride(nil, in: &draft.filters, group: group) }
                else { setUncheckedOverride(defaultUnchecked(group), in: &draft.filters, group: group) }
            }
        )
    }

    private func filterOverrideSelection(_ group: TicketAlertFilterGroup, option: String) -> Binding<Bool> {
        Binding(
            get: {
                let unchecked = uncheckedOverride(in: draft.filters, group: group) ?? defaultUnchecked(group)
                return !unchecked.contains(option)
            },
            set: { selected in
                var values = uncheckedOverride(in: draft.filters, group: group) ?? defaultUnchecked(group)
                if selected { values.removeAll { $0 == option } }
                else if !values.contains(option) { values.append(option) }
                setUncheckedOverride(values.sorted(), in: &draft.filters, group: group)
            }
        )
    }

    private func defaultUnchecked(_ group: TicketAlertFilterGroup) -> [String] {
        switch group {
        case .showType: defaults.filters.showType
        case .screenFormat: defaults.filters.screenFormat
        case .screeningTech: defaults.filters.screeningTech
        case .dubLanguage: defaults.filters.dubLanguage
        }
    }

    private func uncheckedOverride(in value: TicketAlertCriteriaOverride.FilterOverrides?, group: TicketAlertFilterGroup) -> [String]? {
        switch group {
        case .showType: value?.showType
        case .screenFormat: value?.screenFormat
        case .screeningTech: value?.screeningTech
        case .dubLanguage: value?.dubLanguage
        }
    }

    private func setUncheckedOverride(_ values: [String]?, in value: inout TicketAlertCriteriaOverride.FilterOverrides?, group: TicketAlertFilterGroup) {
        var filters = value ?? .init()
        switch group {
        case .showType: filters.showType = values
        case .screenFormat: filters.screenFormat = values
        case .screeningTech: filters.screeningTech = values
        case .dubLanguage: filters.dubLanguage = values
        }
        if filters.showType == nil && filters.screenFormat == nil && filters.screeningTech == nil && filters.dubLanguage == nil {
            value = nil
        } else {
            value = filters
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        draft = subscription.criteriaOverrides ?? TicketAlertCriteriaOverride()
        do {
            let response: TicketAlertPreferencesData = try await account.requestPrivate(path: "/api/v1/ticket-alerts/preferences", method: "GET", as: TicketAlertPreferencesData.self)
            defaults = response.preferences
        } catch { self.error = error.localizedDescription }
    }

    private func save() async {
        isSaving = true
        error = nil
        defer { isSaving = false }
        do {
            let body = try JSONEncoder().encode(TicketAlertCriteriaPatch(criteriaOverrides: draft))
            _ = try await account.requestPrivate(path: "/api/v1/ticket-alerts/\(subscription.tmdbId)/criteria", method: "PATCH", body: body)
            onSave(draft)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

private struct TicketAlertCriteriaPatch: Encodable {
    let criteriaOverrides: TicketAlertCriteriaOverride
}

private func preferencesBody(_ preferences: TicketAlertPreferences) throws -> Data {
    let filtersData = try JSONEncoder().encode(preferences.filters)
    let filters = try JSONSerialization.jsonObject(with: filtersData)
    return try JSONSerialization.data(withJSONObject: [
        "cities": preferences.cities as Any? ?? NSNull(),
        "notificationMode": preferences.notificationMode,
        "filters": filters,
    ])
}
