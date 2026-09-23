# Solar calculator checks

From `services/web`, run `npm run test:solar` (Node.js 18 or later). The tests transpile the production TypeScript calculation module using the existing TypeScript dependency; no separate test framework is required.

The independent fixtures come from the supplied Kea Solar Implementation Reference dated 14 September 2026. They cover the Auckland 5 kW example, all three self-use scenarios, annual demand caps, no-payback and horizon cases, charges and credits, operating costs, generation overrides, invalid inputs, units, signed bills and advisor context.

For a browser smoke test, sign in and open Plans → Explore solar savings. Select the 5 kW Auckland example, use 8,000 kWh annual demand, set both import rates to 30c/kWh and both daily charges to $0.90, leaving credits at zero. With the fixed $100/year maintenance and replacement allowance, expect $1,488.11 bill savings, $1,388.11 annual net savings and 8.3 years simple payback. Change an input: the previous figures and advisor action must disappear until recalculation. Check quote mode, Other location, desktop columns and a narrow mobile viewport.

Annual demand is entered manually or explicitly selected as demonstration data because the current client supplies no verified representative annual gross consumption. The Plans selection supplies demonstration tariff defaults. Time-of-use and free-weekend selections use a labelled flat-rate scenario, not an interval bill forecast. Credits require user-confirmed eligibility and expiry. The calculator works without the API; advisor explanations still depend on the existing household and chat services. Numerical what-if questions are directed back to the calculator.
