"use client";

import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";

export interface ImageEditorRef {
  undo: () => void;
  clear: () => void;
  getMaskDataUrl: () => string | null;
}

interface Point { x: number; y: number }
interface Path { brushSize: number; points: Point[] }

interface Props {
  imageUrl: string;
  brushSize: number;
  onMaskChange?: (hasMask: boolean) => void;
}

export const ImageEditor = forwardRef<ImageEditorRef, Props>(({ imageUrl, brushSize, onMaskChange }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const pathsRef = useRef<Path[]>([]);
  const currentPathRef = useRef<Path | null>(null);
  const isDrawingRef = useRef(false);

  // 初始化图片尺寸
  useEffect(() => {
    const img = new Image();
    img.src = imageUrl;
    img.onload = () => {
      setDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      // 注意：这里不要轻易清空 pathsRef，因为组件重渲染可能会重新触发 useEffect
      // 我们只在图片尺寸真正发生变化时才清空
    };
  }, [imageUrl]);

  // 重绘所有的遮罩路径
  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 半透明红色作为遮罩涂抹的视觉反馈
    ctx.strokeStyle = "rgba(239, 68, 68, 0.5)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    pathsRef.current.forEach(path => {
      if (path.points.length === 0) return;
      ctx.lineWidth = path.brushSize;
      ctx.beginPath();
      ctx.moveTo(path.points[0].x, path.points[0].y);
      path.points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.stroke();
    });
  };

  // 当 dimensions 更新或者组件重渲染时，确保画布上的内容不会丢失
  useEffect(() => {
    if (dimensions.width > 0) redraw();
  }, [dimensions]);

  // 将鼠标/触摸坐标转换为真实 Canvas 内部坐标
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // 因为 object-fit: contain 会导致 img 元素在容器内居中缩放，
    // 所以直接用 getBoundingClientRect 会导致坐标偏移。
    // 为了解决这个问题，我们让 Canvas 紧贴着图片。
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    // 防止移动端滚动
    if (e.cancelable) e.preventDefault();
    const coords = getCoordinates(e);
    if (!coords) return;

    isDrawingRef.current = true;
    currentPathRef.current = { brushSize, points: [coords] };
    pathsRef.current.push(currentPathRef.current);
    redraw();
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (e.cancelable) e.preventDefault();
    if (!isDrawingRef.current || !currentPathRef.current) return;
    
    const coords = getCoordinates(e);
    if (!coords) return;

    currentPathRef.current.points.push(coords);
    
    // 为了性能优化，画画时只增量绘制最新的一段，而不是整体 redraw
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && currentPathRef.current.points.length > 1) {
        const points = currentPathRef.current.points;
        const lastPoint = points[points.length - 2];
        const currentPoint = points[points.length - 1];
        
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(239, 68, 68, 0.5)";
        ctx.lineWidth = brushSize;
        
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(currentPoint.x, currentPoint.y);
        ctx.stroke();
    }
  };

  const stopDrawing = () => {
    if (isDrawingRef.current) {
        isDrawingRef.current = false;
        // 如果只是点了一下没拖动，points 只有一个点，我们要过滤掉或者给个默认长度
        if (currentPathRef.current && currentPathRef.current.points.length === 1) {
            const p = currentPathRef.current.points[0];
            currentPathRef.current.points.push({ x: p.x + 1, y: p.y + 1 });
            redraw(); // 把这个点画出来
        }
        
        onMaskChange?.(pathsRef.current.length > 0);
    }
  };

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    undo: () => {
      pathsRef.current.pop();
      redraw();
      onMaskChange?.(pathsRef.current.length > 0);
    },
    clear: () => {
      pathsRef.current = [];
      redraw();
      onMaskChange?.(false);
    },
    getMaskDataUrl: () => {
      if (pathsRef.current.length === 0) return null;
      
      // 创建一张在内存中的临时 Canvas，用来输出黑白 Mask 图片
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = dimensions.width;
      maskCanvas.height = dimensions.height;
      const ctx = maskCanvas.getContext("2d");
      if (!ctx) return null;

      // 黑色背景
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

      // 白色画笔（代表水印区域）
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "white";

      pathsRef.current.forEach(path => {
        if (path.points.length === 0) return;
        ctx.lineWidth = path.brushSize;
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        path.points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
      });

      return maskCanvas.toDataURL("image/png");
    }
  }));

  if (dimensions.width === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-400 animate-pulse">
        加载图片中...
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      className="relative shadow-md select-none touch-none"
      style={{
         display: 'inline-block', // 修改为 inline-block 确保尺寸由图片撑开
         position: 'relative'
      }}
    >
      <img 
        ref={imageRef} 
        src={imageUrl} 
        alt="Upload" 
        className="block pointer-events-none"
        style={{ 
          maxWidth: '100%', 
          maxHeight: '60vh',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain'
        }} 
      />
      <canvas
        ref={canvasRef}
        width={dimensions.width} // 真实物理像素宽
        height={dimensions.height} // 真实物理像素高
        style={{
          width: '100%',  // 逻辑宽度 100% 覆盖 img
          height: '100%', // 逻辑高度 100% 覆盖 img
          position: 'absolute',
          top: 0,
          left: 0,
          cursor: 'crosshair',
          touchAction: 'none' // 彻底禁用移动端手势
        }}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        onTouchCancel={stopDrawing}
      />
    </div>
  );
});

ImageEditor.displayName = "ImageEditor";
