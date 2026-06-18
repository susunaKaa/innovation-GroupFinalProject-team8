<!--
  VoiceMessageBubble.vue — 语音消息气泡（播放、波形动画、转写文本）
  此组件独立于 ChatMessage，可嵌入任意聊天页面
-->
<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'

const props = defineProps<{
  audioUrl: string
  durationSeconds: number
  transcript: string | null
  transcriptStatus?: 'pending' | 'transcribing' | 'completed' | 'failed'
}>()

const isPlaying = ref(false)
const audioRef = ref<HTMLAudioElement | null>(null)
const currentTime = ref(0)
const progressPct = ref(0)

const durationText = computed(() => formatDuration(props.durationSeconds))

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function togglePlay() {
  if (!audioRef.value) return

  if (isPlaying.value) {
    audioRef.value.pause()
    isPlaying.value = false
  } else {
    audioRef.value.currentTime = 0
    audioRef.value.play().catch(() => {
      isPlaying.value = false
    })
    isPlaying.value = true
  }
}

function onTimeUpdate() {
  if (audioRef.value) {
    currentTime.value = audioRef.value.currentTime
    if (audioRef.value.duration) {
      progressPct.value = (audioRef.value.currentTime / audioRef.value.duration) * 100
    }
  }
}

function onEnded() {
  isPlaying.value = false
  progressPct.value = 0
}

onUnmounted(() => {
  if (audioRef.value) {
    audioRef.value.pause()
    audioRef.value = null
  }
})
</script>

<template>
  <div class="voice-bubble">
    <!-- 播放按钮 + 波形条 -->
    <div class="voice-play-row" @click="togglePlay">
      <div class="play-icon" :class="{ playing: isPlaying }">
        <svg v-if="!isPlaying" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5,3 19,12 5,21" />
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      </div>
      <div class="waveform">
        <span
          v-for="i in 12"
          :key="i"
          class="wave-bar-static"
          :class="{ active: isPlaying && (i / 12 * 100 <= progressPct) }"
          :style="{ height: `${10 + Math.sin(i * 0.8) * 8}px` }"
        />
      </div>
      <span class="voice-duration">{{ durationText }}</span>
    </div>

    <!-- 转写文本 -->
    <div v-if="transcript" class="transcript-area">
      <div class="transcript-label">转写文本</div>
      <div class="transcript-text">{{ transcript }}</div>
    </div>
    <div v-else-if="transcriptStatus === 'transcribing'" class="transcript-area">
      <div class="transcript-loading">转写中...</div>
    </div>
    <div v-else-if="transcriptStatus === 'failed'" class="transcript-area">
      <div class="transcript-failed">转写失败</div>
    </div>

    <!-- 隐藏的 audio 元素 -->
    <audio
      ref="audioRef"
      :src="audioUrl"
      preload="auto"
      @timeupdate="onTimeUpdate"
      @ended="onEnded"
    />
  </div>
</template>

<style scoped>
.voice-bubble {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.voice-play-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(83, 74, 183, 0.06);
  border-radius: 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}

.voice-play-row:hover {
  background: rgba(83, 74, 183, 0.1);
}

.play-icon {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #534AB7;
  color: #fff;
  flex-shrink: 0;
}

.play-icon.playing {
  background: #909399;
}

.waveform {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  flex: 1;
  height: 28px;
}

.wave-bar-static {
  flex: 1;
  background: #DCDFE6;
  border-radius: 1px;
  transition: background 0.15s;
}

.wave-bar-static.active {
  background: #534AB7;
}

.voice-duration {
  font-size: 12px;
  color: #909399;
  min-width: 36px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.transcript-area {
  padding: 10px 12px;
  background: #F5F7FA;
  border-radius: 10px;
}

.transcript-label {
  font-size: 11px;
  color: #909399;
  margin-bottom: 4px;
}

.transcript-text {
  font-size: 14px;
  color: #303133;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.transcript-loading {
  font-size: 13px;
  color: #909399;
  text-align: center;
}

.transcript-failed {
  font-size: 13px;
  color: #F56C6C;
  text-align: center;
}
</style>
