import {createApp} from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import axios from 'axios'
import settings from './config/config.js'

axios.defaults.baseURL = settings.ServerUrl + '/api'

const app = createApp(App)
app.use(ElementPlus, {size: 'small', zIndex: 3000})
app.config.globalProperties.$axios = axios
app.mount('#app')