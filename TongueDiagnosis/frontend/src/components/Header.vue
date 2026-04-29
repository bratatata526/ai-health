<template>
  <header class="header">
    <div class="inner">
      <div class="brand">Tongue Diagnosis</div>
      <div class="sub">AI 舌相检测</div>
    </div>
  </header>
</template>

<style scoped>
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #e2e8f0;
}

.inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 14px 20px;
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.brand {
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
}

.sub {
  font-size: 14px;
  color: #475569;
}
</style>
