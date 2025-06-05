// 画笔工具相关变量
let canvas;
let ctx;
let isDrawing = false;
let isDrawMode = false;
let lastX = 0;
let lastY = 0;

// 画笔配置
const DRAW_CONFIG = {
    strokeStyle: '#285FF5',
    lineWidth: 3,
    lineCap: 'round',
    lineJoin: 'round'
};

// 初始化画笔工具
function initDrawTool() {
    canvas = document.getElementById('draw-canvas');
    
    if (!canvas) {
        console.error('Canvas元素未找到！');
        return false;
    }
    
    ctx = canvas.getContext('2d');
    
    // 设置Canvas尺寸
    resizeCanvas();
    
    // 设置画笔样式
    ctx.strokeStyle = DRAW_CONFIG.strokeStyle;
    ctx.lineWidth = DRAW_CONFIG.lineWidth;
    ctx.lineCap = DRAW_CONFIG.lineCap;
    ctx.lineJoin = DRAW_CONFIG.lineJoin;
    
    // 绑定事件
    bindDrawEvents();
    bindToolbarEvents();
    
    // 监听窗口大小变化
    window.addEventListener('resize', resizeCanvas);
    
    console.log('画笔工具初始化完成');
    return true;
}

// 调整Canvas尺寸
function resizeCanvas() {
    const rect = document.getElementById('map').getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    // 重新设置画笔样式（Canvas尺寸改变后样式会重置）
    ctx.strokeStyle = DRAW_CONFIG.strokeStyle;
    ctx.lineWidth = DRAW_CONFIG.lineWidth;
    ctx.lineCap = DRAW_CONFIG.lineCap;
    ctx.lineJoin = DRAW_CONFIG.lineJoin;
}

// 绑定绘图事件
function bindDrawEvents() {
    // 鼠标事件
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseout', stopDraw);
    
    // 触摸事件（移动端支持）
    canvas.addEventListener('touchstart', handleTouch);
    canvas.addEventListener('touchmove', handleTouch);
    canvas.addEventListener('touchend', stopDraw);
}

// 绑定工具栏事件
function bindToolbarEvents() {
    const startDrawBtn = document.getElementById('start-draw');
    const clearDrawBtn = document.getElementById('clear-draw');
    const resetMapBtn = document.getElementById('reset-map');
    
    console.log('绑定工具栏事件...');
    
    if (startDrawBtn) {
        startDrawBtn.addEventListener('click', toggleDrawMode);
    } else {
        console.error('开启绘图按钮未找到！');
    }
    
    if (clearDrawBtn) {
        clearDrawBtn.addEventListener('click', clearCanvas);
    }
    
    // 重置地图交互状态按钮
    if (resetMapBtn) {
        resetMapBtn.addEventListener('click', () => {
            if (window.resetMapInteraction) {
                window.resetMapInteraction();
            }
        });
    }
    
    // 绑定颜色选择事件
    bindColorEvents();
}

// 绑定颜色选择事件
function bindColorEvents() {
    const colorOptions = document.querySelectorAll('.color-option');
    
    console.log('绑定颜色选择事件, 找到', colorOptions.length, '个颜色选项');
    
    if (colorOptions.length === 0) {
        console.warn('未找到颜色选项元素，可能DOM还未完全加载');
        return;
    }
    
    colorOptions.forEach(option => {
        option.addEventListener('click', function() {
            // 移除其他选中状态
            colorOptions.forEach(opt => opt.classList.remove('selected'));
            
            // 选中当前颜色
            this.classList.add('selected');
            
            // 设置画笔颜色
            const color = this.getAttribute('data-color');
            setDrawColor(color);
            
            console.log('切换画笔颜色为：', color);
        });
    });
}

// 切换绘图模式
function toggleDrawMode() {
    const startDrawBtn = document.getElementById('start-draw');
    const colorPanel = document.getElementById('color-panel');
    
    // 调试信息
    console.log('切换绘图模式, isDrawMode将变为:', !isDrawMode);
    
    isDrawMode = !isDrawMode;
    // 将绘图模式状态暴露到全局，便于调试
    window.isDrawMode = isDrawMode;
    
    if (isDrawMode) {
        canvas.classList.add('drawing');
        startDrawBtn.classList.add('active');
        startDrawBtn.textContent = '关闭绘图';
        
        // 显示颜色选择面板
        if (colorPanel) {
            colorPanel.classList.remove('hidden');
            console.log('颜色面板应该显示了, 当前类名:', colorPanel.className);
        } else {
            console.error('颜色面板元素未找到！');
        }
        
        // 禁用地图拖拽，但保留缩放功能
        if (window.map) {
            map.setStatus({
                dragEnable: false,
                zoomEnable: true,  // 保持缩放功能
                doubleClickZoom: false,
                scrollWheel: true  // 确保鼠标滚轮缩放可用
            });
        }
        
        console.log('绘图模式已开启 - 使用铅笔光标');
    } else {
        canvas.classList.remove('drawing');
        startDrawBtn.classList.remove('active');
        startDrawBtn.textContent = '开启绘图';
        
        // 隐藏颜色选择面板
        if (colorPanel) {
            colorPanel.classList.add('hidden');
            console.log('颜色面板应该隐藏了, 当前类名:', colorPanel.className);
        }
        
        // 恢复地图交互
        if (window.map) {
            map.setStatus({
                dragEnable: true,
                zoomEnable: true,
                doubleClickZoom: true
            });
        }
        
        console.log('绘图模式已关闭');
    }
}

// 开始绘制
function startDraw(e) {
    if (!isDrawMode) return;
    
    isDrawing = true;
    
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
    
    // 开始新路径
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
}

// 绘制
function draw(e) {
    if (!isDrawing || !isDrawMode) return;
    
    const rect = canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    
    // 绘制线条
    ctx.lineTo(currentX, currentY);
    ctx.stroke();
    
    // 更新最后位置
    lastX = currentX;
    lastY = currentY;
}

// 停止绘制
function stopDraw() {
    if (!isDrawing) return;
    
    isDrawing = false;
    ctx.beginPath(); // 重置路径
}

// 处理触摸事件
function handleTouch(e) {
    e.preventDefault();
    
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent(getMouseEventType(e.type), {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    
    canvas.dispatchEvent(mouseEvent);
}

// 获取对应的鼠标事件类型
function getMouseEventType(touchType) {
    switch (touchType) {
        case 'touchstart': return 'mousedown';
        case 'touchmove': return 'mousemove';
        case 'touchend': return 'mouseup';
        default: return touchType;
    }
}

// 清除画布
function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    console.log('画布已清除');
}

// 设置画笔颜色
function setDrawColor(color) {
    DRAW_CONFIG.strokeStyle = color;
    ctx.strokeStyle = color;
}

// 设置画笔粗细
function setDrawWidth(width) {
    DRAW_CONFIG.lineWidth = width;
    ctx.lineWidth = width;
}

// 获取画布数据URL（用于保存）
function getCanvasDataURL() {
    return canvas.toDataURL('image/png');
}

// 从数据URL加载画布内容
function loadCanvasFromDataURL(dataURL) {
    const img = new Image();
    img.onload = function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
    };
    img.src = dataURL;
}

// 保存绘图到本地存储
function saveDrawing() {
    const dataURL = getCanvasDataURL();
    localStorage.setItem('mapDrawing', dataURL);
    console.log('绘图已保存到本地存储');
}

// 从本地存储加载绘图
function loadDrawing() {
    const dataURL = localStorage.getItem('mapDrawing');
    if (dataURL) {
        loadCanvasFromDataURL(dataURL);
        console.log('从本地存储加载绘图');
    }
}

// 页面加载完成后初始化画笔工具
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，确保地图已加载
    setTimeout(() => {
        console.log('开始初始化画笔工具...');
        
        // 检查关键元素是否存在
        const drawCanvas = document.getElementById('draw-canvas');
        const colorPanel = document.getElementById('color-panel');
        const startDrawBtn = document.getElementById('start-draw');
        
        console.log('关键元素检查:');
        console.log('draw-canvas:', !!drawCanvas);
        console.log('color-panel:', !!colorPanel);
        console.log('start-draw按钮:', !!startDrawBtn);
        
        if (drawCanvas && colorPanel && startDrawBtn) {
            initDrawTool();
            console.log('画笔工具初始化完成');
        } else {
            console.error('关键元素缺失，无法初始化画笔工具');
            // 延迟重试
            setTimeout(() => {
                console.log('重试初始化...');
                initDrawTool();
            }, 2000);
        }
        
        // 可选：加载之前保存的绘图
        // loadDrawing();
    }, 1000);
});

// 页面卸载前保存绘图
window.addEventListener('beforeunload', () => {
    if (isDrawMode) {
        saveDrawing();
    }
}); 
