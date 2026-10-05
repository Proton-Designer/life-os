import PersonalSubdomainLoading from "./[subdomain]/loading";

// "/personal" is only a redirect into the first kept tab. Without its own boundary it fell back to the app-wide
// loading.tsx, which is HOME's skeleton, so Home flashed before Personal appeared.
export default PersonalSubdomainLoading;
