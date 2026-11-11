// Shared wire reason for the tariff/campaign/discount scenario screens.
//
// Every one of these screens serializes the same not-calculable reason, so it lives here
// regardless of which engine produces it. The unit-assembly helpers that once sat beside it
// (the old assembly context and its commission/variant shims) are gone now that every screen
// prices on the scenario engine (Faz 4B); `scenario-screen-commons.ts` maps the engine's
// issues onto this reason.

// --- Why an item cannot be costed ---

export type TariffItemReason = 'NO_PRODUCT' | 'NO_COST' | 'NO_SHIPPING';
