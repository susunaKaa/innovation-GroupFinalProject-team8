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
  const chunks = ref<Blob[]>([])
  const startY = ref(0)
  const startX = ref(0)
  const currentY = ref(0)
  const timer = ref<ReturnType<typeof setInterval> | null>(null)
  const file = ref<File | null>(null)

  const isRecording = computed(() => state.value === 'recording')
  const isCancelling = computed(() => state.value === 'cancelling')
  const durationText = computed(() => {
    const secs = Math.floor(duration.value)
    const mins = Math.floor(secs / 60)
    const remainSecs = secs % 60
    return `${mins.toString().padStart(2, '0')}:${remainSecs.toString().padStart(2, '0')}`
  })

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
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      chunks.value = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.value.push(e.data)
      }

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
      }

      recorder.start()
      mediaRecorder.value = recorder
      state.value = 'recording'
      duration.value = 0

      // 计时器
      timer.value = setInterval(() => {
        duration.value += 1
      }, 1000)
    } catch (err: any) {
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

    return new Promise((resolve) => {
      const recorder = mediaRecorder.value!

      recorder.onstop = async () => {
        // 清除计时器
        if (timer.value) {
          clearInterval(timer.value)
          timer.value = null
        }

        const wasCancelled = state.value === 'cancelling'

        if (wasCancelled) {
          state.value = 'cancelled'
          resolve(null)
          // 1.5 秒后回到 idle
          setTimeout(() => {
            state.value = 'idle'
            duration.value = 0
          }, 1500)
          return
        }

        // 检查录音是否过短
        if (duration.value < MIN_RECORD_DURATION) {
          state.value = 'too_short'
          resolve(null)
          setTimeout(() => {
            state.value = 'idle'
            duration.value = 0
          }, 2000)
          return
        }

        // 创建音频文件
        const blob = new Blob(chunks.value, { type: 'audio/webm' })
        const audioFile = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' })
        file.value = audioFile

        try {
          state.value = 'idle' // 先回到 idle

          const recordingId = await uploadAndPoll(blob, duration.value)

          if (recordingId !== null) {
            // 获取转写结果
            const detail = await getVoiceDetailApi(recordingId)
            const recording = detail.data

            const result: VoiceRecorderResult = {
              audioBlob: blob,
              duration: duration.value,
              extra: {
                audio_url: recording.file_url || '',
                duration_seconds: recording.duration || duration.value,
                recording_id: recordingId,
                transcript: recording.transcript || null,
                transcript_status: recording.transcript ? 'completed' : 'completed',
              },
            }
            resolve(result)
          } else {
            // 上传失败，返回无转写的语音消息
            const result: VoiceRecorderResult = {
              audioBlob: blob,
              duration: duration.value,
              extra: {
                audio_url: '',
                duration_seconds: duration.value,
                recording_id: 0,
                transcript: null,
                transcript_status: 'failed',
              },
            }
            resolve(result)
          }
        } catch {
          const result: VoiceRecorderResult = {
            audioBlob: blob,
            duration: duration.value,
            extra: {
              audio_url: '',
              duration_seconds: duration.value,
              recording_id: 0,
              transcript: null,
              transcript_status: 'failed',
            },
          }
          resolve(result)
        }

        duration.value = 0
      }

      // 停止录音
      if (recorder.state === 'recording') {
        recorder.stop()
      }
    })
  }

  /** 上传音频并轮询等待转写完成 */
  async function uploadAndPoll(blob: Blob, dur: number): Promise<number | null> {
    try {
      // 创建 File 对象用于上传
      const audioFile = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' })
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
            // 转写失败但仍可使用语音消息
            return recordingId
          }
        } catch {
          continue
        }
      }
      return recordingId // 超时也返回 recordingId
    } catch {
      return null
    }
  }

  /** 重置状态 */
  function reset() {
    state.value = 'idle'
    duration.value = 0
    chunks.value = []
    if (timer.value) {
      clearInterval(timer.value)
      timer.value = null
    }
  }

  onUnmounted(() => {
    if (timer.value) clearInterval(timer.value)
    if (mediaRecorder.value && mediaRecorder.value.state === 'recording') {
      mediaRecorder.value.stop()
    }
  })

  return {
    state,
    duration,
    durationText,
    isRecording,
    isCancelling,
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
