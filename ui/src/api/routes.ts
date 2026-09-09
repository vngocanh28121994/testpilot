/**
 * Mọi đường dẫn `/api/*` của TestPilot, khai báo đúng một lần.
 *
 * Không route nào được viết dưới dạng chuỗi trực tiếp ở chỗ khác: `server.ts`
 * điều phối bằng `switch` trên chuỗi `"METHOD /path"` khớp chính xác, nên một
 * lỗi gõ không trả 404 rõ ràng — nó rơi xuống nhánh static cuối cùng và trả về
 * index.html của app cũ với status 200.
 *
 * 9 route đánh dấu STREAM trả về SSE-over-POST, KHÔNG phải JSON. Chúng đi qua
 * `lib/streamJob.ts` chứ không qua `api/client.ts`.
 */
export const ROUTES = {
  state: '/api/state',
  config: '/api/config',
  history: '/api/history',
  healing: '/api/healing',
  healingReview: '/api/healing/review',
  runLog: '/api/run/log',
  preflight: '/api/preflight',
  vocabulary: '/api/vocabulary',
  actions: '/api/actions',
  actionsReview: '/api/actions/review',
  modelKey: '/api/model-key',
  models: '/api/models',
  builds: '/api/builds',
  appUpload: '/api/app/upload',
  feature: '/api/feature',
  featureNormalize: '/api/feature/normalize',
  featureReview: '/api/feature/review',
  featureKnownIssue: '/api/feature/known-issue',
  featureReviewBulk: '/api/feature/review-bulk',
  studioSave: '/api/studio/save',
  workflowQuestions: '/api/workflow/questions',
  workflowAnswers: '/api/workflow/answers',
  confluenceAuth: '/api/confluence-auth',
  mcpTools: '/api/mcp/tools',
  runStop: '/api/run/stop',
  runActive: '/api/run/active',
  runAttach: '/api/run/attach',
  aws: '/api/aws',
  farmDevices: '/api/farm/devices',
  farmPools: '/api/farm/pools',
  farmProjects: '/api/farm/projects',
  farmPool: '/api/farm/pool',
  prereqAdb: '/api/prereq/adb',
  prereqXcode: '/api/prereq/xcode',
  prereqIosNames: '/api/prereq/ios-names',
  prereqIosDevices: '/api/prereq/ios-devices',
  prereqAppiumStatus: '/api/prereq/appium/status',
} as const;

/** 9 route SSE-over-POST. Đi qua streamJob(), không qua api.post(). */
export const STREAM_ROUTES = {
  gen: '/api/gen',
  run: '/api/run',
  farmRun: '/api/farm/run',
  awsLogin: '/api/aws/login',
  workflowComplete: '/api/workflow/complete',
  prereqAppium: '/api/prereq/appium',
  prereqAppiumRestart: '/api/prereq/appium/restart',
  prereqDriver: '/api/prereq/driver',
} as const;

export type StreamRoute = (typeof STREAM_ROUTES)[keyof typeof STREAM_ROUTES];
