<script setup>
import Header from '@/components/Header.vue'
import Check from '@/views/Check.vue'
</script>
<template>
  <div class="app-container">
    <Header></Header>
    <main class="main-content">
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
  padding-top: 72px;
  min-height: 100vh;
  position: relative;
  z-index: 1;
}

.main-content > * {
  min-height: calc(100vh - 72px);
}
</style>