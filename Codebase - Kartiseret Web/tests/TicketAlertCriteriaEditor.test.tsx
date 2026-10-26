import { DEFAULT_TICKET_ALERT_CRITERIA, type TicketAlertCriteria } from "@kartiseret/contracts/private-data";
import { TicketAlertCriteriaEditor } from "../src/components/TicketAlertCriteriaEditor";
import { useUserPreferencesStore } from "../src/stores/userPreferencesStore";
import { ALL_LOCATIONS } from "@kartiseret/contracts/preferences";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

describe("TicketAlertCriteriaEditor", () => {
  it("saves account city selections and filter exclusions", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const value: TicketAlertCriteria = {
      notificationMode: "first_any_city",
      cities: ["Jerusalem"],
      filters: {
        showType: ["Premium"],
        screenFormat: [],
        screeningTech: [],
        dubLanguage: [],
      },
    };
    render(
      <TicketAlertCriteriaEditor
        mode="defaults"
        value={value}
        defaults={value}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Haifa" }));
    await user.click(screen.getByRole("checkbox", { name: "Premium" }));
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(onSave).toHaveBeenCalledWith({
      notificationMode: "first_any_city",
      cities: ["Jerusalem", "Haifa"],
      filters: {
        showType: [],
        screenFormat: [],
        screeningTech: [],
        dubLanguage: [],
      },
    });
  });

  it("stores only fields changed for a title so other fields inherit", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const defaults: TicketAlertCriteria = {
      notificationMode: "first_any_city",
      cities: ["Haifa", "Jerusalem"],
      filters: {
        showType: ["Premium"],
        screenFormat: [],
        screeningTech: ["IMAX"],
        dubLanguage: [],
      },
    };
    render(
      <TicketAlertCriteriaEditor
        mode="title"
        value={{}}
        defaults={defaults}
        onSave={onSave}
      />,
    );

    const inheritToggles = screen.getAllByRole("checkbox", {
      name: "Use account default",
    });
    await user.click(inheritToggles[0]!);
    await user.click(screen.getByRole("checkbox", { name: "Haifa" }));
    await user.click(screen.getByRole("button", { name: "Save criteria" }));

    expect(onSave).toHaveBeenCalledWith({ cities: ["Jerusalem"] });
    expect(DEFAULT_TICKET_ALERT_CRITERIA.cities).toBeNull();
  });
  it("defaults to the preferred city and saves explicit all-city selection and notification mode", async () => {
    useUserPreferencesStore.setState((state) => ({
      preferences: { ...state.preferences, location: "Haifa" },
    }));
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <TicketAlertCriteriaEditor
        mode="defaults"
        value={DEFAULT_TICKET_ALERT_CRITERIA}
        defaults={DEFAULT_TICKET_ALERT_CRITERIA}
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Haifa" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Jerusalem" }),
    ).not.toBeChecked();
    await user.click(
      screen.getByRole("radio", { name: /First in each selected city/ }),
    );
    await user.click(screen.getByRole("button", { name: "All cities" }));
    await user.click(screen.getByRole("button", { name: "Save criteria" }));
    expect(onSave).toHaveBeenLastCalledWith({
      ...DEFAULT_TICKET_ALERT_CRITERIA,
      cities: [...ALL_LOCATIONS],
      notificationMode: "first_per_city",
    });
    await user.click(
      screen.getByRole("button", { name: "Use preferred city (Haifa)" }),
    );
    await user.click(screen.getByRole("button", { name: "Save criteria" }));
    expect(onSave).toHaveBeenLastCalledWith({
      ...DEFAULT_TICKET_ALERT_CRITERIA,
      notificationMode: "first_per_city",
    });
    useUserPreferencesStore.setState((state) => ({
      preferences: { ...state.preferences, location: "Jerusalem" },
    }));
  });
  it("stores a title mode override and can restore inheritance", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <TicketAlertCriteriaEditor
        mode="title"
        value={{}}
        defaults={DEFAULT_TICKET_ALERT_CRITERIA}
        onSave={onSave}
      />,
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Use account notification mode" }),
    );
    await user.click(
      screen.getByRole("radio", { name: /First in each selected city/ }),
    );
    await user.click(screen.getByRole("button", { name: "Save criteria" }));
    expect(onSave).toHaveBeenLastCalledWith({
      notificationMode: "first_per_city",
    });
    await user.click(
      screen.getByRole("checkbox", { name: "Use account notification mode" }),
    );
    await user.click(screen.getByRole("button", { name: "Save criteria" }));
    expect(onSave).toHaveBeenLastCalledWith({});
  });
});
