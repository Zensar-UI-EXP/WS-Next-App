import axios from "axios";

// Every API call goes through this module.
const http = axios.create({
  baseURL: "",   // the API is served by the same Next.js app
  headers: { "Content-Type": "application/json" },
});

// POC without SSO: the chosen user is sent on every request as X-User; the API looks up the role and entitlements.
export function setUser(userId) {
  http.defaults.headers.common["X-User"] = userId;
}

/** Turns an RFC 7807 ProblemDetails response (or a network error) into a readable message. */
export function errorMessage(error) {
  const problem = error?.response?.data;
  if (problem && typeof problem === "object") {
    if (problem.errors) {
      return Object.values(problem.errors).flat().join(" ");
    }
    return problem.detail || problem.title || `Request failed (${error.response.status}).`;
  }
  if (error?.code === "ERR_NETWORK") {
    return "The server is not reachable. Is the Next.js app running (npm run dev)?";
  }
  return error?.message || "Something went wrong.";
}

const data = (promise) => promise.then((r) => r.data);

// Users, catalogue and dropdowns
export const getUsers = () => data(http.get("/api/users"));
export const getCatalog = () => data(http.get("/api/catalog"));
export const getLookup = (type) => data(http.get(`/api/lookups/${type}`));
export const runBlock = (scope, parameters, block, signal) =>
  data(http.post("/api/blocks/run", { scope, parameters, block }, { signal }));

// Templates (designer and approver)
export const getReports = () => data(http.get("/api/reports"));
export const getReport = (id) => data(http.get(`/api/reports/${id}`));
export const getVersion = (id, versionNo) => data(http.get(`/api/reports/${id}/versions/${versionNo}`));
export const createReport = (body) => data(http.post("/api/reports", body));
export const saveDraft = (id, body) => data(http.put(`/api/reports/${id}/draft`, body));
export const previewDraft = (id) => data(http.post(`/api/reports/${id}/draft/preview`));
export const submitDraft = (id) => data(http.post(`/api/reports/${id}/draft/submit`));
export const runVersion = (id, versionNo, parameters) =>
  data(http.post(`/api/reports/${id}/versions/${versionNo}/run`, { parameters }));
export const approveVersion = (id, versionNo, comment) =>
  data(http.post(`/api/reports/${id}/versions/${versionNo}/approve`, { comment }));
export const rejectVersion = (id, versionNo, comment) =>
  data(http.post(`/api/reports/${id}/versions/${versionNo}/reject`, { comment }));

// Households and analysis
export const getHouseholds = () => data(http.get("/api/households"));
export const getAnalysis = (householdId, params) => data(http.get(`/api/households/${householdId}/analysis`, { params }));

// Client reports
export const getTemplates = () => data(http.get("/api/templates"));
export const getClientReports = () => data(http.get("/api/client-reports"));
export const getClientReport = (id) => data(http.get(`/api/client-reports/${id}`));
export const createClientReport = (body) => data(http.post("/api/client-reports", body));
export const saveClientReport = (id, definition) => data(http.put(`/api/client-reports/${id}`, { definition }));
export const submitClientReport = (id, definition) => data(http.post(`/api/client-reports/${id}/submit`, { definition }));
export const approveClientReport = (id, comment) => data(http.post(`/api/client-reports/${id}/approve`, { comment }));
export const returnClientReport = (id, comment) => data(http.post(`/api/client-reports/${id}/return`, { comment }));
export const runClientReport = (id, definition, pageIds, signal) =>
  data(http.post(`/api/client-reports/${id}/run`, { definition, pageIds }, { signal }));
export const askStudio = (id, page, instruction) => data(http.post(`/api/client-reports/${id}/ask`, { page, instruction }));
export const getReportRuns = (id) => data(http.get(`/api/client-reports/${id}/runs`));
export const getReportTrail = (id) => data(http.get(`/api/client-reports/${id}/trail`));
export const getRun = (runId) => data(http.get(`/api/orchestration-runs/${runId}`));

// Governance
export const getDataQuality = (includeResolved) => data(http.get("/api/governance/data-quality", { params: { includeResolved } }));
export const runDataQuality = () => data(http.post("/api/governance/data-quality/run"));
export const updateException = (id, status, note) => data(http.put(`/api/governance/data-quality/${id}`, { status, note }));
export const getAudit = (params) => data(http.get("/api/governance/audit", { params }));
export const getAiMonitoring = () => data(http.get("/api/governance/ai"));
export const getAiInteraction = (id) => data(http.get(`/api/governance/ai/${id}`));
export const getMethodology = () => data(http.get("/api/governance/methodology"));

// V7: agent reports
export const getAgentReports = () => data(http.get("/api/agent-reports"));
export const createAgentReport = (body) => data(http.post("/api/agent-reports", body));
export const getAgentReport = (id) => data(http.get(`/api/agent-reports/${id}`));
export const runAgentReport = (id) => data(http.post(`/api/agent-reports/${id}/run`));
export const getAgentFigures = (id) => data(http.get(`/api/agent-reports/${id}/figures`));
export const changeAgentReport = (id, request) => data(http.post(`/api/agent-reports/${id}/changes`, { request }));
export const editAgentReport = (id, definition, note) => data(http.put(`/api/agent-reports/${id}/edit`, { definition, note }));
export const saveReusableDefinition = (id, body) => data(http.post(`/api/agent-reports/${id}/reusable`, body));
export const getReusableDefinitions = () => data(http.get("/api/reusable-definitions"));
export const getKnowledge = () => data(http.get("/api/knowledge"));
export const runPublish = () => data(http.post("/api/publish"));
export const previewAgentReport = (id, definition, pageIds) => data(http.post(`/api/agent-reports/${id}/preview`, { definition, pageIds }));
export const askAgentStudio = (id, page, instruction) => data(http.post(`/api/agent-reports/${id}/ask`, { page, instruction }));
export const submitAgentReport = (id) => data(http.post(`/api/agent-reports/${id}/submit`));
export const getCoverTemplates = () => data(http.get("/api/cover-templates"));
export const createCoverTemplate = (body) => data(http.post("/api/cover-templates", body));
export const saveCoverTemplate = (id, body) => data(http.put(`/api/cover-templates/${id}`, body));
export const submitCoverTemplate = (id) => data(http.post(`/api/cover-templates/${id}/submit`));
export const decideCoverTemplate = (id, approve, comment) => data(http.post(`/api/cover-templates/${id}/${approve ? "approve" : "return"}`, { comment }));

// V10: the cover options (what the Cover tab offers and what the cover agent may change), approved by compliance.
export const getCoverOptions = () => data(http.get("/api/cover-options"));
export const saveCoverOptions = (set) => data(http.put("/api/cover-options", set));
export const discardCoverOptions = () => data(http.delete("/api/cover-options/draft"));
export const submitCoverOptions = () => data(http.post("/api/cover-options/submit"));
export const decideCoverOptions = (approve, comment) => data(http.post(`/api/cover-options/${approve ? "approve" : "return"}`, { comment }));

// V9: the cover agent. kind is "agent-reports" or "client-reports".
export const getCoverAgent = (kind, id) => data(http.get(`/api/${kind}/${id}/cover-agent`));
export const startCoverAgent = (kind, id, body) => data(http.post(`/api/${kind}/${id}/cover-agent`, body));
export const decideCoverAgent = (kind, id, runId, body) => data(http.post(`/api/${kind}/${id}/cover-agent/${runId}/decision`, body));
