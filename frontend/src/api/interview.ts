/**
 * AI 模拟面试 API
 */
import request from './request'
import type { APIResponse, PaginatedResponse } from '@/types'
import type {
  InterviewSession,
  InterviewSessionDetail,
  InterviewCreateParams,
  InterviewAnswerParams,
  InterviewReport,
} from '@/types/interview'

/** 创建面试会话 */
export function createInterviewApi(
  data: InterviewCreateParams
): Promise<APIResponse<InterviewSession>> {
  return request.post('/v1/interview/sessions', data)
}

/** 获取面试会话列表 */
export function listInterviewSessionsApi(
  page = 1,
  pageSize = 20
): Promise<APIResponse<PaginatedResponse<InterviewSession>>> {
  return request.get('/v1/interview/sessions', { params: { page, page_size: pageSize } })
}

/** 获取面试会话详情 */
export function getInterviewSessionApi(
  sessionId: number
): Promise<APIResponse<InterviewSessionDetail>> {
  return request.get(`/v1/interview/sessions/${sessionId}`)
}

/** 开始面试 */
export function startInterviewSessionApi(
  sessionId: number
): Promise<APIResponse<InterviewSessionDetail>> {
  return request.post(`/v1/interview/sessions/${sessionId}/start`)
}

/** 提交当前问题回答 */
export function submitInterviewAnswerApi(
  sessionId: number,
  data: InterviewAnswerParams
): Promise<APIResponse<InterviewSessionDetail>> {
  return request.post(`/v1/interview/sessions/${sessionId}/answer`, data)
}

/** 结束面试 */
export function finishInterviewSessionApi(
  sessionId: number
): Promise<APIResponse<InterviewReport>> {
  return request.post(`/v1/interview/sessions/${sessionId}/finish`)
}

/** 获取面试报告 */
export function getInterviewReportApi(
  sessionId: number
): Promise<APIResponse<InterviewReport>> {
  return request.get(`/v1/interview/sessions/${sessionId}/report`)
}
