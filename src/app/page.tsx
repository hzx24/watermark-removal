"use client";

import { useState, useRef } from "react";
import { UploadCloud, Eraser, Download, Image as ImageIcon, RotateCcw, Loader2, Undo2 } from "lucide-react";
import { ImageEditor, ImageEditorRef } from "@/components/ImageEditor";

export default function Home() {
  const [image, setImage] = useState<string | null>(null);
  // 使用数组来保存图片历史记录，支持多次撤销
  const [imageHistory, setImageHistory] = useState<string[]>([]);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [brushSize, setBrushSize] = useState<number>(20);
  const [hasMask, setHasMask] = useState<boolean>(false);
  const editorRef = useRef<ImageEditorRef>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const url = event.target?.result as string;
        setImage(url);
        setImageHistory([url]); // 初始化历史记录
        setResultImage(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleReset = () => {
    setImage(null);
    setImageHistory([]);
    setResultImage(null);
    setHasMask(false);
  };

  const handleUndo = () => {
    editorRef.current?.undo();
  };

  const handleContinueEditing = () => {
    if (resultImage) {
      // 把当前的结果图推入历史记录栈
      const newHistory = [...imageHistory, resultImage];
      setImageHistory(newHistory);
      setImage(resultImage);
      setResultImage(null);
      setHasMask(false);
      editorRef.current?.clear();
    }
  };

  const handleDiscardResult = () => {
    // 不满意最新一次的结果，直接丢弃，此时画布上依然保留着之前的涂抹轨迹
    setResultImage(null);
  };

  const handleUndoHistory = () => {
    // 撤销到上一次的图片状态
    if (imageHistory.length > 1) {
      const newHistory = [...imageHistory];
      newHistory.pop(); // 弹出当前状态
      const previousImage = newHistory[newHistory.length - 1]; // 获取上一个状态
      setImageHistory(newHistory);
      setImage(previousImage);
      setResultImage(null);
      setHasMask(false);
      editorRef.current?.clear();
    }
  };

  const handleProcessImage = async () => {
    const maskDataUrl = editorRef.current?.getMaskDataUrl();
    if (!maskDataUrl || !image) return;
    
    setIsProcessing(true);
    
    try {
      // 发送请求到我们刚刚编写的 Next.js API 路由
      const response = await fetch('/api/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: image, // 注意：如果是本地 blob URL，无法发给后端，必须转 base64
          mask: maskDataUrl
        })
      });

      const data = await response.json();
      
      if (response.ok && data.resultUrl) {
        setResultImage(data.resultUrl);
      } else {
        alert("处理失败：" + (data.error || "未知错误"));
      }
    } catch (error) {
      alert("网络请求失败，请检查控制台");
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!resultImage) return;
    try {
      // 因为阿里云 OSS 默认不允许前端跨域 (CORS) 下载图片
      // 所以我们通过自己后端的 API 中转一下下载请求
      const response = await fetch(`/api/download?url=${encodeURIComponent(resultImage)}`);
      
      if (!response.ok) {
        throw new Error("下载失败");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "no-watermark-" + Date.now() + ".jpg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      alert("下载失败，您可以右键图片直接保存");
      console.error("Download Error:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4">
      {/* 头部标题区域 */}
      <header className="text-center mb-10">
        <h1 className="text-4xl font-bold text-gray-900 mb-4 flex items-center justify-center gap-3">
          <div className="p-3 bg-blue-100 rounded-2xl text-blue-600">
            <Eraser className="w-8 h-8" />
          </div>
          智能去水印工具
        </h1>
        <p className="text-gray-600">免费、快速、本地化处理图片水印，简单涂抹即可消除</p>
      </header>

      {/* 主体内容区域 */}
      <main className="w-full max-w-5xl bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden flex flex-col md:flex-row min-h-[600px]">
        
        {/* 左侧：图片展示与编辑区 */}
        <div className="flex-1 bg-gray-100 relative flex items-center justify-center border-r border-gray-200 min-h-[400px]">
          {!image ? (
            <label className="flex flex-col items-center justify-center w-full h-full cursor-pointer hover:bg-gray-200/50 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <UploadCloud className="w-16 h-16 text-gray-400 mb-4" />
                <p className="mb-2 text-gray-600"><span className="font-semibold text-blue-600">点击上传</span> 或拖拽图片至此</p>
                <p className="text-xs text-gray-500">支持 PNG, JPG, JPEG (最大 10MB)</p>
              </div>
              <input type="file" className="hidden" accept="image/png, image/jpeg, image/jpg" onChange={handleImageUpload} />
            </label>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center relative p-6">
              {/* 顶部操作栏 */}
              <div className="absolute top-4 right-4 z-10 flex gap-2">
                <button 
                  onClick={handleReset}
                  className="bg-white/90 backdrop-blur text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium shadow-sm hover:bg-white flex items-center gap-1.5 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  重新上传
                </button>
              </div>
              
              {/* 图片/Canvas 占位区域 */}
              <div className="relative w-full h-full flex items-center justify-center">
                {/* 使用 display 控制显隐，保证 ImageEditor 不被卸载，从而保留涂抹轨迹 */}
                <div 
                  className="w-full h-full flex items-center justify-center"
                  style={{ display: resultImage ? 'none' : 'flex' }}
                >
                  <ImageEditor 
                    ref={editorRef} 
                    imageUrl={image} 
                    brushSize={brushSize} 
                    onMaskChange={(hasMask) => setHasMask(hasMask)} 
                  />
                </div>

                {resultImage && (
                  <img 
                    src={resultImage} 
                    alt="Result preview" 
                    className="max-w-full max-h-full object-contain rounded shadow-sm" 
                  />
                )}

                {/* 处理中遮罩 */}
                {isProcessing && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex flex-col items-center justify-center rounded z-20">
                    <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-3" />
                    <p className="text-gray-800 font-medium">AI 正在擦除水印...</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 右侧：操作面板 */}
        <div className="w-full md:w-80 p-6 flex flex-col bg-white">
          <h3 className="text-lg font-bold text-gray-900 mb-6">操作面板</h3>
          
          <div className="space-y-6 flex-1">
            {/* 画笔设置 */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-gray-700">画笔粗细</label>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">{brushSize}px</span>
              </div>
              <input 
                type="range" 
                min="5" 
                max="80" 
                value={brushSize}
                onChange={(e) => setBrushSize(parseInt(e.target.value))}
                className="w-full accent-blue-600" 
                disabled={!image} 
              />
            </div>

            {/* 操作按钮组 */}
            <div className="space-y-3 pt-4 border-t border-gray-100">
              <div className="flex gap-2">
                <button 
                  onClick={handleUndo}
                  className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm" 
                  disabled={!hasMask || isProcessing || !!resultImage}
                >
                  <RotateCcw className="w-4 h-4" />
                  撤销画笔
                </button>
                
                <button 
                  onClick={handleUndoHistory}
                  className="flex-1 py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm" 
                  disabled={imageHistory.length <= 1 || isProcessing || !!resultImage}
                >
                  <Undo2 className="w-4 h-4" />
                  撤回上一步
                </button>
              </div>

              {resultImage && (
                <button 
                  onClick={handleDiscardResult}
                  className="w-full py-3 px-4 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-xl flex items-center justify-center gap-2 transition-colors font-medium"
                >
                  <RotateCcw className="w-4 h-4" />
                  对结果不满意，返回重涂
                </button>
              )}

              <button 
                onClick={resultImage ? handleContinueEditing : handleProcessImage}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-sm shadow-blue-200" 
                disabled={(!hasMask && !resultImage) || isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  resultImage ? <Eraser className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />
                )}
                {isProcessing ? '处理中...' : (resultImage ? '确认结果，继续擦除' : '一键去水印')}
              </button>
            </div>
          </div>

          {/* 底部下载按钮 */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <button 
              onClick={handleDownload}
              className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold shadow-sm shadow-green-200" 
              disabled={!resultImage}
            >
              <Download className="w-5 h-5" />
              下载无水印图片
            </button>
          </div>
        </div>

      </main>
    </div>
  );
}
