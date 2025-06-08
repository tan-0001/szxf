 // 全局变量
let map;
let projectMarkers = [];
let projectsData = [];
let currentZoom = 13;

// 地图配置 - 南山区中心
const MAP_CONFIG = {
    center: [113.9304, 22.5333], // 深圳南山区中心坐标
    zoom: 12.5, // 调整为12.5级，适合显示项目点位
    minZoom: 10.8,
    maxZoom: 18
};

// 初始化地图
function initMap() {
    console.log('开始初始化代理项目佣金地图...');
    
    // 检查高德地图API是否已加载
    if (typeof AMap === 'undefined') {
        console.error('高德地图API未加载！请检查网络连接和API引用。');
        alert('地图加载失败，请检查网络连接后刷新页面');
        return;
    }
    
    console.log('高德地图API已加载，版本:', AMap.v);

    try {
        // 创建3D地图实例
        map = new AMap.Map('map', {
            center: MAP_CONFIG.center,
            zoom: MAP_CONFIG.zoom,
            zooms: [MAP_CONFIG.minZoom, MAP_CONFIG.maxZoom],
            mapStyle: 'amap://styles/normal',
            // 3D地图核心配置
            viewMode: '3D',           // 启用3D模式
            terrain: true,            // 启用地形
            pitch: 0,                // 设置地图俯仰角度(0-83度)
            rotation: 0,              // 设置地图旋转角度(0-360度)
            scrollWheel: true,        // 启用鼠标滚轮缩放
            zoomEnable: true,         // 启用缩放
            doubleClickZoom: true,    // 启用双击缩放
            dragEnable: true,         // 启用拖拽
            pitchEnable: false,        // 启用俯仰角调节（3D模式关键配置）
            rotateEnable: false        // 启用旋转（3D模式关键配置）
        });

        console.log('3D地图对象创建成功');

        // 监听地图加载完成事件
        map.on('complete', () => {
            console.log('3D地图加载完成！');
        });

        // 监听地图加载错误事件
        map.on('error', (error) => {
            console.error('地图加载错误:', error);
        });

        // 添加3D控制罗盘 - 用于调节地图的水平角度和俯仰角度
        const controlBar = new AMap.ControlBar({
            position: {
                top: '90px',          // 调整到搜索框下方，避免重叠
                right: '20px'         // 与搜索框右对齐
            },
            showZoomBar: true,        // 显示缩放条
            showControlButton: true   // 显示倾斜、旋转控制按钮
        });
        map.addControl(controlBar);
        console.log('3D控制罗盘已添加');

        // 添加工具栏和比例尺 - 放置在右下角
        map.addControl(new AMap.ToolBar({
            position: 'RB'
        }));
        
        map.addControl(new AMap.Scale({
            position: 'RB'
        }));

        // 监听缩放事件
        map.on('zoomend', onZoomChange);

        // 3D地图事件监听器
        // 监听俯仰角变化
        map.on('pitchchange', function() {
            const pitch = map.getPitch();
            console.log('俯仰角度变化:', pitch + '°');
        });

        // 监听旋转角度变化
        map.on('rotatechange', function() {
            const rotation = map.getRotation();
            console.log('旋转角度变化:', rotation + '°');
        });

        console.log('3D地图初始化完成，当前配置：');
        console.log('- 俯仰角度:', map.getPitch() + '°');
        console.log('- 旋转角度:', map.getRotation() + '°');
        console.log('- 缩放级别:', map.getZoom());
        
    } catch (error) {
        console.error('3D地图初始化失败:', error);
        alert('3D地图初始化失败: ' + error.message);
    }
}

// 缩放变化处理 - 简化为两种模式
function onZoomChange() {
    currentZoom = map.getZoom();
    console.log('当前缩放级别:', currentZoom);
    
    if (currentZoom >= 12) {
        // 12级以上：显示代理项目标记
        showProjectMarkers();
        console.log('显示模式：代理项目标记');
    } else {
        // 12级以下：隐藏项目标记
        hideProjectMarkers();
        console.log('显示模式：隐藏项目标记');
    }
}

// 加载数据 - 只加载代理项目
async function loadData() {
    try {
        console.log('开始加载代理项目数据...');
        
        // 从文件加载项目数据
        const projectsResponse = await fetch('projects.json');
        
        if (projectsResponse.ok) {
            const allProjectsData = await projectsResponse.json();
            
            // 筛选出代理项目（daili: "yes"）
            projectsData = allProjectsData.filter(project => project.daili === "yes");
            
            console.log('数据加载成功');
            console.log('全部项目数据:', allProjectsData.length, '个');
            console.log('代理项目数据:', projectsData.length, '个');
        } else {
            console.log('项目数据文件加载失败');
            projectsData = [];
        }
        
        // 初始化项目标记
        initProjectMarkers();
        
        // 获取当前缩放级别并显示内容
        currentZoom = map.getZoom();
        console.log('数据加载完成，当前缩放级别:', currentZoom);
        
        // 根据当前缩放级别显示内容
        onZoomChange();
        
    } catch (error) {
        console.error('加载数据失败:', error);
        projectsData = [];
    }
}

// 初始化代理项目点位
function initProjectMarkers() {
    console.log('初始化代理项目点位，数量:', projectsData.length);
    
    projectsData.forEach((project, index) => {
        // 创建标记，文字在图标上方，统一使用绿色样式
        const markerContent = `
            <div class="project-marker">
                <div class="marker-text">${project.name}</div>
                <div class="marker-pin"></div>
            </div>
        `;

        const marker = new AMap.Marker({
            position: project.coordinates,
            content: markerContent,
            anchor: 'bottom-center'
        });

        // 点击事件 - 显示佣金信息
        marker.on('click', () => {
            showCommissionInfoWindow(project, marker);
        });

        projectMarkers.push(marker);
        console.log(`添加代理项目: ${project.name}`);
    });
}

// 显示佣金信息窗 - 修改显示内容
function showCommissionInfoWindow(project, marker) {
    const content = `
        <div class="info-window">
            <h3>${project.name}</h3>
            <p class="price">价格: ${project.price}</p>
            <p class="commission">佣金: ${project.yongjin || '面谈'}</p>
            <p class="period">代理期限: ${project.data || '长期有效'}</p>
            <span class="status">代理项目</span>
        </div>
    `;

    const infoWindow = new AMap.InfoWindow({
        content: content,
        anchor: 'bottom-center',
        offset: new AMap.Pixel(0, -10)
    });

    infoWindow.open(map, marker.getPosition());
}

// 显示代理项目标记
function showProjectMarkers() {
    projectMarkers.forEach(marker => {
        map.add(marker);
    });
}

// 隐藏代理项目标记
function hideProjectMarkers() {
    projectMarkers.forEach(marker => {
        map.remove(marker);
    });
}

// 搜索功能 - 只搜索代理项目
function initSearch() {
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');

    if (!searchInput || !searchResults) return;

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        if (query.length === 0) {
            searchResults.style.display = 'none';
            return;
        }

        const results = searchProjects(query);
        showSearchResults(results);
    });

    // 点击外部关闭搜索结果
    document.addEventListener('click', (e) => {
        if (!document.getElementById('search-bar').contains(e.target)) {
            searchResults.style.display = 'none';
        }
    });
}

// 搜索代理项目
function searchProjects(query) {
    return projectsData.filter(project => 
        project.name.toLowerCase().includes(query.toLowerCase())
    );
}

// 显示搜索结果
function showSearchResults(results) {
    const searchResults = document.getElementById('search-results');
    
    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-item">未找到相关代理项目</div>';
    } else {
        searchResults.innerHTML = results.map(project => `
            <div class="search-item" onclick="selectProject('${project.name}')">
                <div class="search-item-name">${project.name}</div>
                <div class="search-item-info">${project.price} | 佣金: ${project.yongjin || '面谈'}</div>
            </div>
        `).join('');
    }
    
    searchResults.style.display = 'block';
}

// 选择项目
function selectProject(projectName) {
    const project = projectsData.find(p => p.name === projectName);
    if (project) {
        map.panTo(project.coordinates);
        map.setZoom(16);
        
        setTimeout(() => {
            const marker = projectMarkers.find(m => 
                m.getPosition().lng === project.coordinates[0] && 
                m.getPosition().lat === project.coordinates[1]
            );
            if (marker) {
                showCommissionInfoWindow(project, marker);
            }
        }, 500);
    }
    
    document.getElementById('search-results').style.display = 'none';
    document.getElementById('search-input').value = '';
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('深圳代理项目佣金地图开始初始化...');
    
    // 延迟一点时间确保高德地图API完全加载
    setTimeout(() => {
        initMap();
        loadData();
        initSearch();
        
        console.log('深圳代理项目佣金地图初始化完成');
    }, 100);
});

// ==================== 3D地图辅助功能 ====================

/**
 * 设置3D地图视角
 * @param {number} pitch - 俯仰角度 (0-83)
 * @param {number} rotation - 旋转角度 (0-360)
 * @param {boolean} animate - 是否使用动画过渡
 */
function set3DView(pitch = 0, rotation = 0, animate = true) {
    if (!map) {
        console.error('地图未初始化');
        return;
    }
    
    if (animate) {
        // 使用动画平滑过渡
        map.setPitch(pitch, true);
        map.setRotation(rotation, true);
    } else {
        // 立即设置
        map.setPitch(pitch);
        map.setRotation(rotation);
    }
    
    console.log(`3D视角已设置 - 俯仰角: ${pitch}°, 旋转角: ${rotation}°`);
}

/**
 * 重置3D视角到默认状态
 */
function reset3DView() {
    set3DView(0, 0, true);
    console.log('3D视角已重置到默认状态');
}

/**
 * 获取当前3D视角信息
 * @returns {Object} 包含pitch和rotation的对象
 */
function get3DViewInfo() {
    if (!map) {
        console.error('地图未初始化');
        return null;
    }
    
    const info = {
        pitch: map.getPitch(),
        rotation: map.getRotation(),
        zoom: map.getZoom(),
        center: map.getCenter()
    };
    
    console.log('当前3D视角信息:', info);
    return info;
}

/**
 * 切换到鸟瞰视角
 */
function setBirdEyeView() {
    set3DView(70, 0, true);
    console.log('已切换到鸟瞰视角');
}

/**
 * 切换到街景视角
 */
function setStreetView() {
    set3DView(20, 0, true);
    console.log('已切换到街景视角');
}

/**
 * 旋转地图一周（演示动画效果）
 */
function rotate360() {
    if (!map) {
        console.error('地图未初始化');
        return;
    }
    
    let currentRotation = map.getRotation();
    const targetRotation = currentRotation + 360;
    
    const rotateStep = () => {
        currentRotation += 5;
        map.setRotation(currentRotation % 360);
        
        if (currentRotation < targetRotation) {
            setTimeout(rotateStep, 50);
        }
    };
    
    rotateStep();
    console.log('开始360度旋转演示');
}

// 全局暴露3D控制函数，方便在控制台调用调试
if (typeof window !== 'undefined') {
    window.set3DView = set3DView;
    window.reset3DView = reset3DView;
    window.get3DViewInfo = get3DViewInfo;
    window.setBirdEyeView = setBirdEyeView;
    window.setStreetView = setStreetView;
    window.rotate360 = rotate360;
}

console.log('代理项目佣金地图辅助功能已加载，可在控制台使用以下函数：');
console.log('- set3DView(pitch, rotation, animate): 设置3D视角');
console.log('- reset3DView(): 重置3D视角');
console.log('- get3DViewInfo(): 获取当前3D视角信息');
console.log('- setBirdEyeView(): 鸟瞰视角');
console.log('- setStreetView(): 街景视角');
console.log('- rotate360(): 360度旋转演示');