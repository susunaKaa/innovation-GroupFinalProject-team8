/**
 * useVoiceRecorder — 微信式语音录制逻辑
 *
 * 简化版：单次 getUserMedia，避免双重调用消耗用户手势
 * 功能：按住说话/松开发送/上滑取消/时长显示/过短提示
 */
import { ref, computed, onUnmounted } from 'vue'
import { uploadVoiceApi, getVoiceStatusApi, getVoiceDetailApi } from '@/api/voice'
import type { VoiceRecorderState, VoiceMessageExtra } from '@/types/voice'

export interface VoiceRecorderResult {
  audioBlob: Blob
  duration: number
  extra: VoiceMessageExtra
}

const MIN_RECORD_DURATION = 1
const CANCEL_DISTANCE = 80
const POLL_INTERVAL = 2000
const MAX_POLL_TIME = 120000

export function useVoiceRecorder() {
  const state = ref<VoiceRecorderState>('idle')
  const duration = ref(0)
  const mediaRecorder = ref<MediaRecorder | null>(null)
  const streamRef = ref<MediaStream | null>(null)
  const chunks = ref<Blob[]>([])
  const startY = ref(0)
  const startX = ref(0)
  const timer = ref<ReturnType<typeof setInterval> | null>(null)
  const isProcessing = ref(false)
  const lastError = ref('')

  const isRecording = computed(() => state.value === 'recording')
  const isCancelling = computed(() => state.value === 'cancelling')
  const durationText = computed(() => {
    const secs = Math.floor(duration.value)
    const mins = Math.floor(secs / 60)
    const remainSecs = secs % 60
    return `${mins.toString().padStart(2, '0')}:${remainSecs.toString().padStart(2, '0')}`
  })

  /** -- 内部: 释放流 -- */
  function stopStreamTracks() {
    if (streamRef.value) {
      streamRef.value.getTracks().forEach((t) => t.stop())
      streamRef.value = null
    }
  }

  /** -- 内部: 清除计时器 -- */
  function clearTimer() {
    if (timer.value) { clearInterval(timer.value); timer.value = null }
  }

  /** -- 开始录音（核心：只调一次 getUserMedia） -- */
  async function startRecording(): Promise<void> {
    if (state.value !== 'idle') return
    if (isProcessing.value) return

    // 先设置状态，让 UI 立即有反馈（用户松开前不会调用 getUserMedia）
    // 但实际上 getUserMedia 需要用户手势，所以我们在这里调
    try {
      // ★ 只这一次 getUserMedia
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.value = stream

      // 选择 MIME 类型
      let mimeType = ''
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus'
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm'
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4'
      }

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      chunks.value = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.value.push(e.data)
      }

      recorder.start(1000) // 每秒收集一个 chunk
      mediaRecorder.value = recorder
      state.value = 'recording'
      duration.value = 0

      // 启动计时
      timer.value = setInterval(() => { duration.value += 1 }, 1000)
    } catch (err: any) {
      // 友好错误信息
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        lastError.value = '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风。\n提示：手机端访问需使用 HTTPS 或 localhost。'
      } else if (err.name === 'NotFoundError') {
        lastError.value = '未检测到麦克风设备'
      } else if (err.name === 'NotReadableError') {
        lastError.value = '麦克风被其他应用占用'
      } else {
        lastError.value = `无法启动录音：${err.message || '未知错误'}`
      }
      state.value = 'idle'
      throw new Error(lastError.value)
    }
  }

  /** -- 处理移动 -- */
  function handleMove(clientY: number) {
    if (state.value !== 'recording' && state.value !== 'cancelling') return
    const deltaY = startY.value - clientY
    state.value = deltaY > CANCEL_DISTANCE ? 'cancelling' : 'recording'
  }

  /** -- 设置起始位置 -- */
  function setStartPosition(x: number, y: number) {
    startX.value = x; startY.value = y
  }

  /** -- 停止录音 -- */
  async function stopRecording(): Promise<VoiceRecorderResult | null> {
    if (!mediaRecorder.value) return null
    if (isProcessing.value) return null

    isProcessing.value = true
    clearTimer()

    const wasCancelling = state.value === 'cancelling'
    const dur = duration.value
    const savedChunks = [...chunks.value]
    const recorder = mediaRecorder.value
    mediaRecorder.value = null // 立即解除引用

    return new Promise((resolve) => {
      recorder.onstop = async () => {
        stopStreamTracks()

        if (wasCancelling) {
          state.value = 'cancelled'
          isProcessing.value = false
          resolve(null)
          setTimeout(() => { state.value = 'idle'; duration.value = 0 }, 1500)
          return
        }

        if (dur < MIN_RECORD_DURATION) {
          state.value = 'too_short'
          isProcessing.value = false
          resolve(null)
          setTimeout(() => { state.value = 'idle'; duration.value = 0 }, 2000)
          return
        }

        // 回到 idle 状态
        state.value = 'idle'
        duration.value = 0

        try {
          const blob = new Blob(savedChunks, { type: recorder.mimeType || 'audio/webm' })
          const recordingId = await uploadAndPoll(blob)

          if (recordingId !== null) {
            const detail = await getVoiceDetailApi(recordingId)
            const recording = detail.data
            resolve({
              audioBlob: blob,
              duration: dur,
              extra: {
                audio_url: recording.file_url || '',
                duration_seconds: recording.duration || dur,
                recording_id: recordingId,
                transcript: recording.transcript || null,
                transcript_status: recording.transcript ? 'completed' : 'completed',
              },
            })
          } else {
            resolve({ audioBlob: blob, duration: dur, extra: { audio_url: '', duration_seconds: dur, recording_id: 0, transcript: null, transcript_status: 'failed' } })
          }
        } catch {
          resolve({ audioBlob: blob, duration: dur, extra: { audio_url: '', duration_seconds: dur, recording_id: 0, transcript: null, transcript_status: 'failed' } })
        }
        isProcessing.value = false
      }

      if (recorder.state === 'recording') {
        recorder.requestData()
        recorder.stop()
      } else {
        recorder.dispatchEvent(new Event('stop'))
      }
    })
  }

  /** -- 上传 + 轮询 -- */
  async function uploadAndPoll(blob: Blob): Promise<number | null> {
    try {
      const audioFile = new File([blob], `voice_${Date.now()}.webm`, { type: blob.type || 'audio/webm' })
      const uploadRes = await uploadVoiceApi(audioFile)
      const recordingId = uploadRes.data.id

      const startTime = Date.now()
      while (Date.now() - startTime < MAX_POLL_TIME) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        try {
          const statusRes = await getVoiceStatusApi(recordingId)
          const s = statusRes.data.status
          if (s === 'completed' || s === 'transcribed' || s === 'failed') return recordingId
        } catch { continue }
      }
      return recordingId
    } catch { return null }
  }

  /** -- 重置 -- */
  function reset() {
    clearTimer()
    stopStreamTracks()
    if (mediaRecorder.value && mediaRecorder.value.state === 'recording') {
      mediaRecorder.value.stop()
    }
    mediaRecorder.value = null
    state.value = 'idle'
    duration.value = 0
    chunks.value = []
    isProcessing.value = false
    lastError.value = ''
  }

  onUnmounted(() => reset())

  return {
    state, duration, durationText, isRecording, isCancelling, isProcessing, lastError,
    startRecording, stopRecording, handleMove, setStartPosition, reset,
    MIN_RECORD_DURATION,
  }
}
