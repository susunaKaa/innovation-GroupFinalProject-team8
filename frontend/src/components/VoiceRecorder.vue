<!--
  VoiceRecorder.vue — 微信式按住说话按钮
  支持：按住说话 / 松开发送 / 上滑取消 / 录音时长 / 过短提示
-->
<script setup lang="ts">
import { ref } from 'vue'
import { useVoiceRecorder } from '@/composables/useVoiceRecorder'

const emit = defineEmits<{
  (e: 'result', result: any): void
  (e: 'error', message: string): void
}>()

const {
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
} = useVoiceRecorder()

const btnRef = ref<HTMLElement | null>(null)

/** 按下开始 */
async function onTouchStart(e: TouchEvent | MouseEvent) {
  e.preventDefault()

  // 检查麦克风权限
  const hasPermission = await checkPermission()
  if (!hasPermission) {
    emit('error', '麦克风权限被拒绝，请在设置中允许访问麦克风')
    return
  }

  const clientX = e instanceof TouchEvent ? e.touches[0].clientX : e.clientX
  const clientY = e instanceof TouchEvent ? e.touches[0].clientY : e.clientY
  setStartPosition(clientX, clientY)
  await startRecording()
}

/** 移动检测上滑 */
function onTouchMove(e: TouchEvent | MouseEvent) {
  if (!isRecording.value && !isCancelling.value) return
  const clientY = e instanceof TouchEvent ? e.touches[0].clientY : e.clientY
  handleMove(clientY)
}

/** 松开停止 */
async function onTouchEnd() {
  if (state.value === 'idle') return

  const result = await stopRecording()
  if (result) {
    emit('result', result)
  }
}

const stateLabel: Record<string, string> = {
  idle: '按住 说话',
  recording: '松开 发送',
  cancelling: '松开 取消',
  cancelled: '已取消',
  too_short: '说话时间太短',
}
</script>

<template>
  <div class="voice-recorder">
    <!-- 录音状态提示条 -->
    <Transition name="fade">
      <div v-if="isRecording || isCancelling" class="recording-indicator">
        <div class="recording-wave">
          <span v-for="i in 5" :key="i" class="wave-bar" :class="{ cancelling: isCancelling }" />
        </div>
        <span class="recording-time">{{ durationText }}</span>
        <span class="recording-hint">
          {{ isCancelling ? '松开取消' : '上滑取消' }}
        </span>
      </div>
    </Transition>

    <!-- 状态提示 -->
    <Transition name="fade">
      <div v-if="state === 'too_short'" class="state-toast">
        说话时间太短（< {{ MIN_RECORD_DURATION }} 秒）
      </div>
      <div v-else-if="state === 'cancelled'" class="state-toast">
        已取消
      </div>
    </Transition>

    <!-- 按住说话按钮 -->
    <button
      ref="btnRef"
      class="record-button"
      :class="{
        recording: isRecording,
        cancelling: isCancelling,
      }"
      @mousedown="onTouchStart"
      @mousemove="onTouchMove"
      @mouseup="onTouchEnd"
      @mouseleave="onTouchEnd"
      @touchstart.prevent="onTouchStart"
      @touchmove.prevent="onTouchMove"
      @touchend.prevent="onTouchEnd"
    >
      <span class="record-label">{{ stateLabel[state] || '按住 说话' }}</span>
    </button>
  </div>
</template>

<style scoped>
.voice-recorder {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
}

/* 录音指示条 */
.recording-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: rgba(83, 74, 183, 0.08);
  border: 1px solid rgba(83, 74, 183, 0.15);
  border-radius: 20px;
  font-size: 12px;
  color: #534AB7;
}

.recording-wave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 20px;
}

.wave-bar {
  width: 3px;
  min-height: 4px;
  background: #534AB7;
  border-radius: 2px;
  animation: wave 0.6s ease-in-out infinite;
}

.wave-bar:nth-child(2) { animation-delay: 0.1s; }
.wave-bar:nth-child(3) { animation-delay: 0.2s; }
.wave-bar:nth-child(4) { animation-delay: 0.3s; }
.wave-bar:nth-child(5) { animation-delay: 0.4s; }

.wave-bar.cancelling {
  background: #F56C6C;
}

@keyframes wave {
  0%, 100% { height: 4px; }
  50% { height: 16px; }
}

.recording-time {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  min-width: 36px;
}

.recording-hint {
  font-size: 11px;
  color: #999;
}

/* 状态提示 */
.state-toast {
  padding: 4px 16px;
  background: rgba(245, 108, 108, 0.08);
  border: 1px solid rgba(245, 108, 108, 0.2);
  border-radius: 20px;
  font-size: 12px;
  color: #F56C6C;
}

/* 按住说话按钮 */
.record-button {
  width: 100%;
  max-width: 320px;
  height: 44px;
  border: 1px solid #DCDFE6;
  border-radius: 22px;
  background: #fff;
  font-size: 15px;
  color: #606266;
  cursor: pointer;
  user-select: none;
  touch-action: none;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.record-button:active {
  background: #f0f0f0;
  transform: scale(0.98);
}

.record-button.recording {
  background: #534AB7;
  color: #fff;
  border-color: #534AB7;
}

.record-button.cancelling {
  background: #F56C6C;
  color: #fff;
  border-color: #F56C6C;
}

.record-label {
  pointer-events: none;
}

/* 动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
