import ort from 'onnxruntime-web';
console.log('default export keys:', Object.keys(ort).join(', '));
console.log('env type:', typeof ort.env);
console.log('InferenceSession:', typeof ort.InferenceSession);
if (ort.env) console.log('env.wasm:', typeof ort.env.wasm);
