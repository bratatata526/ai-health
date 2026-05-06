<script setup>
import Header from '@/components/Header.vue'
import Check from '@/views/Check.vue'

const isInIframe = typeof window !== 'undefined' && window.self !== window.top
</script>
<template>
  <div class="app-container">
    <Header></Header>
    <main class="main-content" :style="{ paddingTop: isInIframe ? '0px' : '72px' }">
      <Check></Check>
    </main>
  </div>
</template>

<style>
#app {
  padding: 0;
  margin: 0;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Segoe UI', 'PingFang SC', sans-serif;
  line-height: 1.6;
  color: #333;
  background-color: #f8f9fa;
}

.main-content {
  min-height: 100vh;
  position: relative;
  z-index: 1;
}

.main-content > * {
  min-height: 100vh;
}
</style>