import { Platform } from 'react-native';

const App = Platform.OS === 'web'
  ? require('./App.web').default
  : require('./App.native').default;

export default App;
