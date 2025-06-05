// 全局变量
let map;
let blockPolygons = [];
let projectMarkers = [];
let blockLabels = [];
let projectCountLabels = [];
let blocksData = [];
let projectsData = [];
let currentZoom = 13;

// 地图配置 - 南山区中心
const MAP_CONFIG = {
    center: [113.9304, 22.5333], // 深圳南山区中心坐标
    zoom: 12.5, // 调整为12.5级，在板块名称+楼盘数量显示范围内
    minZoom: 10,
    maxZoom: 18
};

// 初始化地图
function initMap() {
    console.log('开始初始化地图...');
    
    // 检查高德地图API是否已加载
    if (typeof AMap === 'undefined') {
        console.error('高德地图API未加载！请检查网络连接和API引用。');
        alert('地图加载失败，请检查网络连接后刷新页面');
        return;
    }
    
    console.log('高德地图API已加载，版本:', AMap.v);
    
    // 安全密钥已在HTML中设置

    try {
        map = new AMap.Map('map', {
            center: MAP_CONFIG.center,
            zoom: MAP_CONFIG.zoom,
            minZoom: MAP_CONFIG.minZoom,
            maxZoom: MAP_CONFIG.maxZoom,
            mapStyle: 'amap://styles/normal',
            // 移除features限制，使用默认配置以显示所有POI信息
            viewMode: '2D',
            scrollWheel: true,
            zoomEnable: true,
            doubleClickZoom: true
        });

        console.log('地图对象创建成功');

        // 监听地图加载完成事件
        map.on('complete', () => {
            console.log('地图加载完成！');
        });

        // 监听地图加载错误事件
        map.on('error', (error) => {
            console.error('地图加载错误:', error);
        });

        // 添加工具栏和比例尺 - 放置在右下角
        map.addControl(new AMap.ToolBar({
            position: 'RB'
        }));
        
        map.addControl(new AMap.Scale({
            position: 'RB'
        }));

        // 监听缩放事件
        map.on('zoomend', onZoomChange);

        console.log('地图初始化完成');
        
    } catch (error) {
        console.error('地图初始化失败:', error);
        alert('地图初始化失败: ' + error.message);
    }
}

// 缩放变化处理
function onZoomChange() {
    currentZoom = map.getZoom();
    console.log('当前缩放级别:', currentZoom);
    
    if (currentZoom >= 9 && currentZoom < 11.5) {
        // 10-11.5级：只显示板块多边形
        showBlocksOnly();
        hideProjectMarkers();
        console.log('显示模式：仅板块多边形');
    } else if (currentZoom >= 11.5 && currentZoom < 13.2) {
        // 11.5-14级：显示板块名称 + 楼盘数量，隐藏新房点位
        showBlocksWithCount();
        hideProjectMarkers();
        console.log('显示模式：板块名称 + 楼盘数量');
    } else if (currentZoom >= 13.2 && currentZoom <= 16) {
        // 14-18级：显示板块名称 + 新房点位（多边形最大显示到18级）
        showBlocksSmall();
        showProjectMarkers();
        console.log('显示模式：板块名称 + 新房点位');
    } else if (currentZoom > 16 && currentZoom <= 20) {
        // 18级以上：只显示新房点位，隐藏板块多边形和标签
        hideBlockPolygons(); // 新增函数：隐藏板块多边形
        hideBlockLabels();
        showProjectMarkers();
        console.log('显示模式：仅新房点位（无板块）');
    } else {
        // 其他级别：隐藏所有
        hideBlockLabels();
        hideProjectMarkers();
        hideBlockPolygons(); // 确保多边形也被隐藏
        console.log('显示模式：隐藏所有');
    }
}

// 加载数据
async function loadData() {
    try {
        console.log('开始加载数据...');
        
        // 从文件加载数据
        const [blocksResponse, projectsResponse] = await Promise.all([
            fetch('blocks.json'),
            fetch('projects.json')
        ]);
        
        if (blocksResponse.ok && projectsResponse.ok) {
            blocksData = await blocksResponse.json();
            projectsData = await projectsResponse.json();
            
            console.log('数据加载成功');
            console.log('板块数据:', blocksData.length, '个');
            console.log('项目数据:', projectsData.length, '个');
        } else {
            console.log('数据文件加载失败');
            blocksData = [];
            projectsData = [];
        }
        
        // 初始化图层
        initBlockPolygons();
        initProjectMarkers();
        
        // 获取当前缩放级别并显示内容
        currentZoom = map.getZoom();
        console.log('数据加载完成，当前缩放级别:', currentZoom);
        
        // 根据当前缩放级别显示内容
        onZoomChange();
        
    } catch (error) {
        console.error('加载数据失败:', error);
        blocksData = [];
        projectsData = [];
    }
}

// 初始化板块多边形
function initBlockPolygons() {
    console.log('初始化板块多边形，数量:', blocksData.length);
    
    blocksData.forEach((block, index) => {
        console.log(`处理板块 ${index + 1}: ${block.name}`, block);
        
        // 创建多边形
        const polygon = new AMap.Polygon({
            path: block.coordinates,
            fillColor: block.color || '#FF6B6B',
            fillOpacity: block.opacity || 0.6,
            strokeColor: block.borderColor || '#FF5252',
            strokeWeight: 2,
            strokeOpacity: 0.8
        });

        // 获取中心点 - 计算多边形的实际中心
        let center;
        
        // 计算多边形坐标的平均值作为中心点
        const coords = block.coordinates;
        let sumLng = 0, sumLat = 0;
        coords.forEach(coord => {
            sumLng += coord[0];
            sumLat += coord[1];
        });
        center = [sumLng / coords.length, sumLat / coords.length];
        
        console.log(`计算中心点: ${block.name}`, center);

        // 创建板块名称标签
        const label = new AMap.Text({
            text: block.name,
            position: center,
            anchor: 'center',
            style: {
                'background-color': 'transparent',
                'border': 'none',
                'padding': '4px 8px',
                'font-size': '14px',
                'font-weight': 'bold',
                'color': '#ffffff',
                'text-align': 'center',
                'text-shadow': '1px 1px 1px #888888, -1px -1px 1px #888888, 1px -1px 1px #888888, -1px 1px 1px #888888'
            }
        });

        blockPolygons.push(polygon);
        blockLabels.push(label);

        // 添加到地图
        map.add([polygon, label]);
        
        console.log(`成功添加板块: ${block.name}，中心点:`, center);
    });
    
    console.log('板块多边形初始化完成，总数:', blockPolygons.length);
    console.log('板块标签初始化完成，总数:', blockLabels.length);
}

// 初始化新房点位
function initProjectMarkers() {
    console.log('初始化新房点位，数量:', projectsData.length);
    
    projectsData.forEach((project, index) => {
        // 创建标记，文字在图标上方
        const markerContent = `
            <div class="project-marker ${project.status}">
                <div class="marker-text">${project.name}</div>
                <div class="marker-pin"></div>
            </div>
        `;

        const marker = new AMap.Marker({
            position: project.coordinates,
            content: markerContent,
            anchor: 'bottom-center'
        });

        // 点击事件
        marker.on('click', () => {
            showInfoWindow(project, marker);
        });

        // 双击事件
        marker.on('dblclick', () => {
            if (project.url) {
                window.open(project.url, '_blank');
            }
        });

        projectMarkers.push(marker);
        console.log(`添加项目: ${project.name}`);
    });
}

// 显示信息窗
function showInfoWindow(project, marker) {
    const statusText = project.status === 'on-sale' ? '在售' : '待售';
    const statusClass = project.status;

    const content = `
        <div class="info-window">
            <h3>${project.name}</h3>
            <p class="price">价格: ${project.price}</p>
            <p>面积: ${project.area}</p>
            <p>总价: ${project.totalPrice}</p>
            <span class="status ${statusClass}">${statusText}</span>
        </div>
    `;

    const infoWindow = new AMap.InfoWindow({
        content: content,
        anchor: 'bottom-center',
        offset: new AMap.Pixel(0, -10)
    });

    infoWindow.open(map, marker.getPosition());
}

// 显示板块和楼盘数量（10-13级）
function showBlocksWithCount() {
    console.log('显示板块和楼盘数量，板块数量:', blockLabels.length);
    
    // 显示板块多边形
    blockPolygons.forEach((polygon, index) => {
        polygon.show();
        console.log(`显示板块多边形 ${index + 1}: ${blocksData[index]?.name}`);
    });

    // 显示板块标签，包含楼盘数量
    blockLabels.forEach((label, index) => {
        const block = blocksData[index];
        if (!block) {
            console.warn(`板块数据缺失，索引: ${index}`);
            return;
        }
        
        const count = getProjectCountInBlock(block);
        const labelText = count > 0 ? `${block.name}\n${count}个` : block.name;
        
        console.log(`设置板块标签: ${block.name}, 文本: ${labelText}`);
        
        label.setText(labelText);
        label.show();
        label.setStyle({
            'background-color': 'transparent',
            'border': 'none',
            'font-size': '14px',
            'padding': '6px 10px',
            'font-weight': 'bold',
            'white-space': 'pre-line',
            'text-align': 'center',
            'color': '#ffffff',
            'text-shadow': '1px 1px 1px #888888, -1px -1px 1px #888888, 1px -1px 1px #888888, -1px 1px 1px #888888'
        });
    });
}

// 显示小字体板块名称（14-18级）
function showBlocksSmall() {
    console.log('显示小字体板块名称，板块数量:', blockLabels.length);
    
    // 检查当前缩放级别，如果超过18级则不显示多边形
    if (currentZoom > 18) {
        console.log('当前缩放级别超过18，不显示板块多边形');
        hideBlockPolygons();
        hideBlockLabels();
        return;
    }
    
    // 显示板块多边形（仅在18级及以下）
    blockPolygons.forEach((polygon, index) => {
        polygon.show();
        console.log(`显示板块多边形 ${index + 1}: ${blocksData[index]?.name}`);
    });
    
    // 显示板块名称（小字体，只显示名称）
    blockLabels.forEach((label, index) => {
        const block = blocksData[index];
        if (!block) {
            console.warn(`板块数据缺失，索引: ${index}`);
            return;
        }
        
        console.log(`设置小字体板块标签: ${block.name}`);
        
        label.setText(block.name);
        label.show();
        label.setStyle({
            'background-color': 'transparent',
            'border': 'none',
            'font-size': '12px',
            'padding': '3px 6px',
            'font-weight': 'bold',
            'white-space': 'nowrap',
            'text-align': 'center',
            'color': '#ffffff',
            'text-shadow': '1px 1px 1px #888888, -1px -1px 1px #888888, 1px -1px 1px #888888, -1px 1px 1px #888888'
        });
    });
}

// 计算板块内的楼盘数量
function getProjectCountInBlock(block) {
    let count = 0;
    projectsData.forEach(project => {
        if (isPointInPolygon(project.coordinates, block.coordinates)) {
            count++;
        }
    });
    return count;
}

// 判断点是否在多边形内
function isPointInPolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    
    return inside;
}

// 显示新房点位
function showProjectMarkers() {
    projectMarkers.forEach(marker => {
        map.add(marker);
    });
}

// 隐藏新房点位
function hideProjectMarkers() {
    projectMarkers.forEach(marker => {
        map.remove(marker);
    });
}

// 隐藏板块标签
function hideBlockLabels() {
    blockLabels.forEach(label => {
        label.hide();
    });
}

// 隐藏板块多边形
function hideBlockPolygons() {
    console.log('隐藏板块多边形，数量:', blockPolygons.length);
    blockPolygons.forEach((polygon, index) => {
        polygon.hide();
        console.log(`隐藏板块多边形 ${index + 1}: ${blocksData[index]?.name}`);
    });
}

// 只显示板块多边形（10-11.5级）
function showBlocksOnly() {
    console.log('只显示板块多边形，不显示标签');
    
    // 显示板块多边形
    blockPolygons.forEach((polygon, index) => {
        polygon.show();
        console.log(`显示板块多边形 ${index + 1}: ${blocksData[index]?.name}`);
    });
    
    // 隐藏所有标签
    blockLabels.forEach(label => {
        label.hide();
    });
}

// 搜索功能
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

// 搜索项目
function searchProjects(query) {
    return projectsData.filter(project => 
        project.name.toLowerCase().includes(query.toLowerCase())
    );
}

// 显示搜索结果
function showSearchResults(results) {
    const searchResults = document.getElementById('search-results');
    
    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-item">未找到相关项目</div>';
    } else {
        searchResults.innerHTML = results.map(project => `
            <div class="search-item" onclick="selectProject('${project.name}')">
                <div class="search-item-name">${project.name}</div>
                <div class="search-item-info">${project.price} | ${project.area}</div>
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
                showInfoWindow(project, marker);
            }
        }, 500);
    }
    
    document.getElementById('search-results').style.display = 'none';
    document.getElementById('search-input').value = '';
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('深圳新房展示地图开始初始化...');
    
    // 延迟一点时间确保高德地图API完全加载
    setTimeout(() => {
        initMap();
        loadData();
        initSearch();
        
        console.log('深圳新房展示地图初始化完成');
    }, 100);
}); 
