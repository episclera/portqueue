/**
 * The axios instance every request goes through, and the typed client on top of it.
 *
 * One configured instance rather than bare `fetch` calls: the base URL, the credential mode and
 * the error normalisation below are set once instead of at each call site. The normalisation is
 * the part that matters — an axios error carries the server's JSON `{ error }` body, which the
 * toasts and the page-level error states actually display. The old fetch wrapper discarded the
 * body on reads and left the user with a bare status code.
 */
import axios, { type AxiosInstance } from 'axios';
import type {
  ActionRequestDto,
  ActionResultDto,
  DashboardConfigDto,
  InstanceDto,
  InstancePageDto,
  JobDto,
  JobPageDto,
  QueuePageDto,
  ScheduleDto,
  SchedulePageDto,
  StatsDto,
} from '../../shared/dto';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_MARKER } from '../../shared/constants';

declare global {
  interface Window {
    __PORTQUEUE_DASHBOARD__?: DashboardConfigDto;
  }
}

export const config: DashboardConfigDto = (typeof window !== 'undefined' &&
  window.__PORTQUEUE_DASHBOARD__) || { basePath: '/portqueue' };

/** The axios client. Exported so tests can stub its adapter. */
export const http: AxiosInstance = axios.create({
  baseURL: `${config.basePath}/api`,
  withCredentials: true,
  headers: { [REQUESTED_WITH_HEADER]: REQUESTED_WITH_MARKER },
});

/**
 * Normalise every failure into an `Error` whose message is worth showing: the server's own
 * `{ error }` text when there is one, else the status line, else the transport failure. Without
 * this the UI would surface axios' generic "Request failed with status code 500".
 */
http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const body = error.response?.data as { error?: string } | undefined;
      if (body?.error) throw new Error(body.error);
      if (error.response) {
        throw new Error(`${error.response.status} ${error.response.statusText}`.trim());
      }
      throw new Error(error.message || 'The dashboard server is unreachable.');
    }
    throw error instanceof Error ? error : new Error(String(error));
  },
);

/** Query params, with empty and undefined values dropped so they never reach the URL. */
export type Params = Record<string, string | number | boolean | undefined>;

function clean(params: Params | undefined): Params | undefined {
  if (!params) return undefined;
  const out: Params = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

async function get<T>(path: string, params?: Params): Promise<T> {
  const res = await http.get<T>(path, { params: clean(params) });
  return res.data;
}

/** Shared paging/search arguments every list endpoint accepts. */
export interface ListParams extends Params {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface QueueListParams extends ListParams {
  processingPaused?: boolean;
  inUse?: boolean;
}

export interface InstanceListParams extends ListParams {
  processingPaused?: boolean;
  alive?: boolean;
}

export interface ScheduleListParams extends ListParams {
  queue?: string;
  enabled?: boolean;
}

export interface JobListParams extends ListParams {
  queue?: string;
  statuses?: string;
  scheduleId?: string;
  /** Narrow to the jobs one instance claimed — the instance detail page's table. */
  instanceKey?: string;
}

export const api = {
  getQueues: (params: QueueListParams = {}) => get<QueuePageDto>('/queues', params),
  getStats: (queue?: string) => get<StatsDto>('/stats', { queue }),
  getJobs: (params: JobListParams = {}) => get<JobPageDto>('/jobs', params),
  getJob: (jobId: string) => get<JobDto>(`/jobs/${encodeURIComponent(jobId)}`),
  getSchedules: (params: ScheduleListParams = {}) => get<SchedulePageDto>('/schedules', params),
  getSchedule: (scheduleId: string) =>
    get<ScheduleDto>(`/schedules/${encodeURIComponent(scheduleId)}`),
  getInstances: (params: InstanceListParams = {}) => get<InstancePageDto>('/instances', params),
  getInstance: (instanceKey: string) =>
    get<InstanceDto>(`/instances/${encodeURIComponent(instanceKey)}`),

  action: async (body: ActionRequestDto): Promise<ActionResultDto> => {
    const res = await http.post<ActionResultDto>('/actions', body);
    return res.data;
  },
};
