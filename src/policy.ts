export interface PolicyState {
  testViewed: boolean;
  changedAfterTest: boolean;
  locked: { temperature: number; threshold: number } | null;
}

export const newPolicy = (testViewed = false): PolicyState => ({
  testViewed,
  changedAfterTest: testViewed,
  locked: null,
});

export function changePolicy(state: PolicyState): PolicyState {
  return {
    ...state,
    locked: null,
    changedAfterTest: state.changedAfterTest || state.testViewed,
  };
}

export function lockPolicy(
  state: PolicyState,
  temperature: number,
  threshold: number,
): PolicyState {
  return { ...state, locked: { temperature, threshold } };
}

export function inspectTest(state: PolicyState): PolicyState {
  return {
    ...state,
    testViewed: true,
    changedAfterTest: state.changedAfterTest || !state.locked,
  };
}

export function assessmentStatus(
  state: PolicyState,
  split: string,
  hasPolicyValidation: boolean,
  group?: string,
): string {
  if (group) return "Exploratory group analysis";
  if (state.changedAfterTest) return "Exploratory after test inspection";
  if (split !== "test") return "Exploratory analysis";
  if (state.locked && hasPolicyValidation)
    return "Policy locked before test inspection in this session";
  return "Exploratory test analysis";
}
