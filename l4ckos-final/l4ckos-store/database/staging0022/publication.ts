import { TARGET, RC, fail } from "./policy";
export const VERCEL = {
  project: "prj_FjQfmjB9QTjWxfXAGfBJXN73aAiA",
  team: "team_CXUvSBkeWbzkpzZgd1cPlZiy",
} as const;
/** Command specification only: no spawn, provider SDK, push or deploy here. */
export function manualPublication(
  commit: string,
  sourceClean: boolean,
  apiPass: boolean,
  approvedCommit: string = RC
) {
  if (
    !/^[a-f0-9]{40}$/.test(approvedCommit) ||
    commit !== approvedCommit ||
    !sourceClean
  )
    fail("PUBLICATION_SOURCE_REQUIRED");
  return {
    environment: {
      VERCEL_PROJECT_ID: VERCEL.project,
      VERCEL_ORG_ID: VERCEL.team,
      VITE_DEPLOY_TARGET: "staging",
      VITE_API_URL: "https://api-staging.l4ckos.com.br",
    },
    backend: [
      "/home/yan/.railway/bin/railway",
      "up",
      "--project",
      TARGET.projectId,
      "--environment",
      TARGET.environmentId,
      "--service",
      TARGET.serviceId,
      "--message",
      `RC ${commit} staging manual`,
    ],
    frontend: apiPass
      ? [
          "vercel",
          "deploy",
          "--prebuilt",
          "--prod",
          "--skip-domain",
          "--scope",
          VERCEL.team,
        ]
      : null,
    requiresMigrationPass: true,
    requiresExplicitDeployAuthorization: true,
    noGitPush: true,
    automaticPromotion: false,
  };
}
