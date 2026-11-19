import { useUserPreferencesStore } from "../../src/stores/userPreferencesStore";
import { UserPreferencesPage } from "../../src/components/UserPreferencesPage";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("../../src/lib/authClient", () => ({
  getAuthClient: () => ({
    getSession: async () => ({ data: { user: null }, error: null }),
    listAccounts: async () => ({ data: [], error: null }),
    useSession: { subscribe: () => () => {} },
  }),
}));
vi.mock("../../src/components/maps/loadCityLocationPicker", () => ({
  loadCityLocationPicker: async () => ({ CityLocationPicker: () => null }),
}));
vi.mock("../../src/components/UserMovieDisplayPreferences", () => ({
  UserMovieDisplayPreferences: () => null,
}));
vi.mock("../../src/components/UserTicketAlerts", () => ({
  UserTicketAlerts: () => null,
}));
vi.mock("../../src/components/PasswordSecurityForm", () => ({
  PasswordSecurityForm: () => null,
}));
vi.mock("../../src/components/DeleteAccountSection", () => ({
  DeleteAccountSection: () => null,
}));

afterEach(() => {
  useUserPreferencesStore.setState(
    useUserPreferencesStore.getInitialState(),
    true,
  );
});

describe("UserPreferencesPage", () => {
  it("starts compact and reveals showtime settings in their disclosures", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <UserPreferencesPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "User Preferences", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Showtimes", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change city" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Loading city map...")).not.toBeInTheDocument();
    expect(screen.getByText("All screening options shown")).toBeInTheDocument();

    const cinemas = screen.getByLabelText("Default cinemas");
    expect(cinemas).not.toHaveAttribute("open");
    expect(
      within(cinemas).getByRole("combobox", { name: "City" }),
    ).not.toBeVisible();
    within(cinemas)
      .getAllByRole("checkbox")
      .forEach((checkbox) => expect(checkbox).not.toBeVisible());

    await user.click(screen.getByText("My cinemas"));
    expect(within(cinemas).getByRole("combobox", { name: "City" })).toHaveValue(
      "Jerusalem",
    );
    expect(
      within(cinemas).getByRole("checkbox", {
        name: "Cinema City Jerusalem",
      }),
    ).toBeVisible();

    const filters = screen.getByLabelText("Default screening filters");
    await user.click(screen.getByText("My screening filters"));
    await user.click(within(filters).getByText("Screening type"));
    expect(
      within(filters).getByRole("checkbox", { name: "Regular" }),
    ).toBeVisible();

    const categoryNav = screen.getByRole("navigation", {
      name: "Preference categories",
    });
    await user.click(
      within(categoryNav).getByRole("button", { name: "Discovery" }),
    );
    expect(
      screen.getByRole("heading", { name: "Discovery", level: 2 }),
    ).toBeInTheDocument();
    expect(
      within(categoryNav).getByRole("button", { name: "Discovery" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /Rating sources/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("saves the preference to hide Re-Releases from the three listings", async () => {
    const user = userEvent.setup();
    const state = useUserPreferencesStore.getState();
    const saveHideReReleases = vi.fn(async (hide: boolean) => {
      useUserPreferencesStore.setState((current) => ({
        preferences: { ...current.preferences, hideReReleases: hide },
      }));
      return true;
    });
    useUserPreferencesStore.setState({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "qa@example.test",
      },
      preferences: { ...state.preferences, hideReReleases: false },
      syncing: false,
      saveHideReReleases,
    });

    render(
      <MemoryRouter>
        <UserPreferencesPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Discovery" }));

    const checkbox = screen.getByRole("switch", {
      name: /hide re-releases/i,
    });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);

    expect(saveHideReReleases).toHaveBeenCalledWith(true);
    expect(checkbox).toBeChecked();
  });

  it("saves default showtime filters and excluded cinemas", async () => {
    const user = userEvent.setup();
    const state = useUserPreferencesStore.getState();
    const saveShowtimePreferences = vi.fn(async (showtimePreferences) => {
      useUserPreferencesStore.setState((current) => ({
        preferences: { ...current.preferences, showtimePreferences },
      }));
      return true;
    });
    useUserPreferencesStore.setState({
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "qa@example.test",
      },
      preferences: { ...state.preferences },
      loading: false,
      syncing: false,
      saveShowtimePreferences,
    });

    render(
      <MemoryRouter>
        <UserPreferencesPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByText("My screening filters"));
    await user.click(screen.getByText("Dubbing"));
    const hebrew = screen.getByRole("checkbox", { name: "Hebrew" });
    expect(hebrew).toBeChecked();
    await user.click(hebrew);

    expect(saveShowtimePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        screeningFilters: expect.objectContaining({
          unchecked: expect.objectContaining({ dubLanguage: ["Hebrew"] }),
        }),
      }),
    );
    expect(hebrew).not.toBeChecked();

    await user.click(screen.getByText("My cinemas"));
    const jerusalemCinema = screen.getByRole("checkbox", {
      name: "Cinema City Jerusalem",
    });
    await user.click(jerusalemCinema);
    expect(saveShowtimePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ excludedCinemaIds: ["aK90TvH244M7"] }),
    );
  });
});
