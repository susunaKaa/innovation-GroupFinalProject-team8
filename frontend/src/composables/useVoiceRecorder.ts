/**
 * useVoiceRecorder — 微信式语音录制逻辑
 *
 * 功能：
 * - 使用 MediaRecorder API 录制音频
 * - 上滑检测（距起始点 > 80px 视为取消）
 * - 按住说话、松开发送、上滑取消
 * - 录音时长显示
 * - 录音过短提示（< 1 秒）
 * - 上传音频文件到后端
 * - 轮询转写状态
 */
import { ref, computed, onUnmounted } from 'vue'
import { uploadVoiceApi, getVoiceStatusApi, getVoiceDetailApi } from '@/api/voice'
import type { VoiceRecorderState, VoiceMessageExtra } from '@/types/voice'

export interface VoiceRecorderResult {
  audioBlob: Blob
  duration: number
  extra: VoiceMessageExtra
}

const MIN_RECORD_DURATION = 1 // 最短录音时长（秒）
const CANCEL_DISTANCE = 80 // 上滑取消阈值（像素）
const POLL_INTERVAL = 2000 // 转写状态轮询间隔（毫秒）
const MAX_POLL_TIME = 120000 // 最大轮询时间（毫秒）

export function useVoiceRecorder() {
  const state = ref<VoiceRecorderState>('idle')
  const duration = ref(0)
  const mediaRecorder = ref<MediaRecorder | null>(null)
  const streamRef = ref<MediaStream | null>(null)
  const chunks = ref<Blob[]>([])
  const startY = ref(0)
  const startX = ref(0)
  const currentY = ref(0)
  const timer = ref<ReturnType<typeof setInterval> | null>(null)
  const isProcessing = ref(false) // 防止 stopRecording 重入

  const isRecording = computed(() => state.value === 'recording')
  const isCancelling = computed(() => state.value === 'cancelling')
  const durationText = computed(() => {
    const secs = Math.floor(duration.value)
    const mins = Math.floor(secs / 60)
    const remainSecs = secs % 60
    return `${mins.toString().padStart(2, '0')}:${remainSecs.toString().padStart(2, '0')}`
  })

  /** 停止所有轨道 */
  function stopStreamTracks() {
    if (streamRef.value) {
      streamRef.value.getTracks().forEach((t) => t.stop())
      streamRef.value = null
    }
  }

  /** 清除计时器 */
  function clearTimer() {
    if (timer.value) {
      clearInterval(timer.value)
      timer.value = null
    }
  }

  /** 检查麦克风权限 */
  async function checkPermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      return true
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        return false
      }
      throw err
    }
  }

  /** 开始录音 */
  async function startRecording() {
    if (state.value !== 'idle') return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.value = stream

      // 按优先级选择 MIME 类型：webm opus > webm > mp4 (iOS) > 默认
      let mimeType = ''
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus'
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm'
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4'
      }
      // 如果不支持任何已知类型，MediaRecorder 会使用浏览器默认

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      chunks.value = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.value.push(e.data)
      }

      recorder.onstop = () => {
        stopStreamTracks()
      }

      // 每秒收集一个数据块
      recorder.start(1000)
      mediaRecorder.value = recorder
      state.value = 'recording'
      duration.value = 0

      // 计时器
      timer.value = setInterval(() => {
        duration.value += 1
      }, 1000)
    } catch (err: any) {
      stopStreamTracks()
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('麦克风权限被拒绝，请在浏览器设置中允许访问麦克风')
      }
      throw err
    }
  }

  /** 处理触摸移动（上滑检测） */
  function handleMove(clientY: number) {
    if (state.value !== 'recording' && state.value !== 'cancelling') return
    const deltaY = startY.value - clientY
    currentY.value = clientY

    if (deltaY > CANCEL_DISTANCE) {
      state.value = 'cancelling'
    } else {
      state.value = 'recording'
    }
  }

  /** 设置起始位置 */
  function setStartPosition(x: number, y: number) {
    startX.value = x
    startY.value = y
    currentY.value = y
  }

  /** 停止录音并返回结果，或取消录音返回 null */
  async function stopRecording(): Promise<VoiceRecorderResult | null> {
    if (!mediaRecorder.value) return null
    if (isProcessing.value) return null // 防重入

    isProcessing.value = true

    // 先清理计时器
    clearTimer()

    // 先保存状态快照，因为 state 会在回调中被修改
    const wasCancelling = state.value === 'cancelling'
    const dur = duration.value
    const savedChunks = [...chunks.value]

    // 需要等待 onstop 回调完成
    return new Promise((resolve) => {
      const recorder = mediaRecorder.value!
      // 解除引用，防止后续再次访问
      mediaRecorder.value = null

      recorder.onstop = async () => {
        // 停止流（可能已在 recorder.onstop 中处理过，但确保清理）
        stopStreamTracks()

        if (wasCancelling) {
          state.value = 'cancelled'
          isProcessing.value = false
          resolve(null)
          setTimeout(() => {
            state.value = 'idle'
            duration.value = 0
          }, 1500)
          return
        }

        // 检查录音是否过短
        if (dur < MIN_RECORD_DURATION) {
          state.value = 'too_short'
          isProcessing.value = false
          resolve(null)
          setTimeout(() => {
            state.value = 'idle'
            duration.value = 0
          }, 2000)
          return
        }

        // 创建音频 Blob (使用录制时实际 MIME 类型)
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(savedChunks, { type: mimeType })

        // 状态先回到 idle，UI 不再显示录制状态
        state.value = 'idle'

        try {
          const recordingId = await uploadAndPoll(blob, dur)

          if (recordingId !== null) {
            const detail = await getVoiceDetailApi(recordingId)
            const recording = detail.data

            const result: VoiceRecorderResult = {
              audioBlob: blob,
              duration: dur,
              extra: {
                audio_url: recording.file_url || '',
                duration_seconds: recording.duration || dur,
                recording_id: recordingId,
                transcript: recording.transcript || null,
                transcript_status: recording.transcript ? 'completed' : 'completed',
              },
            }
            isProcessing.value = false
            resolve(result)
          } else {
            const result: VoiceRecorderResult = {
              audioBlob: blob,
              duration: dur,
              extra: {
                audio_url: '',
                duration_seconds: dur,
                recording_id: 0,
                transcript: null,
                transcript_status: 'failed',
              },
            }
            isProcessing.value = false
            resolve(result)
          }
        } catch {
          const result: VoiceRecorderResult = {
            audioBlob: blob,
            duration: dur,
            extra: {
              audio_url: '',
              duration_seconds: dur,
              recording_id: 0,
              transcript: null,
              transcript_status: 'failed',
            },
          }
          isProcessing.value = false
          resolve(result)
        }

        duration.value = 0
      }

      // 停止录制：只有在 recording 状态下才调用 stop
      if (recorder.state === 'recording') {
        // requestData 确保最后一段数据被收集
        recorder.requestData()
        recorder.stop()
      } else if (recorder.state === 'inactive') {
        // 已停止，直接触发 onstop
        recorder.dispatchEvent(new Event('stop'))
      }
    })
  }

  /** 上传音频并轮询等待转写完成 */
  async function uploadAndPoll(blob: Blob, dur: number): Promise<number | null> {
    try {
      const audioFile = new File([blob], `voice_${Date.now()}.webm`, { type: blob.type || 'audio/webm' })
      const uploadRes = await uploadVoiceApi(audioFile)
      const recordingId = uploadRes.data.id

      // 轮询等待转写完成
      const startTime = Date.now()
      while (Date.now() - startTime < MAX_POLL_TIME) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL))
        try {
          const statusRes = await getVoiceStatusApi(recordingId)
          const status = statusRes.data.status
          if (status === 'completed' || status === 'transcribed') {
            return recordingId
          }
          if (status === 'failed') {
            return recordingId
          }
        } catch {
          continue
        }
      }
      return recordingId // 超时也返回，让用户看到语音气泡
    } catch {
      return null
    }
  }

  /** 重置状态 */
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
  }

  onUnmounted(() => {
    reset()
  })

  return {
    state,
    duration,
    durationText,
    isRecording,
    isCancelling,
    isProcessing,
    checkPermission,
    startRecording,
    stopRecording,
    handleMove,
    setStartPosition,
    reset,
    MIN_RECORD_DURATION,
    CANCEL_DISTANCE,
  }
}
