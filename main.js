// 全局变量
let map;
let blockPolygons = [];
let projectMarkers = [];
let blockLabels = [];
let blocksData = [];
let projectsData = [];
let currentZoom = 13;
let statusFilter = 'on-sale'; // 默认只显示在售

// 地图配置 - 南山区中心
const MAP_CONFIG = {
    center: [113.9304, 22.5333], // 深圳南山区中心坐标
    zoom: 12.5, // 调整为12.5级，在板块名称+楼盘数量显示范围内
    minZoom: 10.8,
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
        // 创建3D地图实例
        map = new AMap.Map('map', {
            center: MAP_CONFIG.center,
            zoom: MAP_CONFIG.zoom,
            zooms: [MAP_CONFIG.minZoom, MAP_CONFIG.maxZoom],
            mapStyle: 'amap://styles/normal',
            // 3D地图核心配置
            viewMode: '3D',           // 启用3D模式
            terrain: true,            // 启用地形
            pitch: 0,                // 设置地图俯仰角度(0-83度)，50度为较好的3D观看角度
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

        console.log('3D地图初始化完成');
        
    } catch (error) {
        console.error('3D地图初始化失败:', error);
        alert('3D地图初始化失败: ' + error.message);
    }
}

// 缩放变化处理
function onZoomChange() {
    currentZoom = map.getZoom();
    
    if (currentZoom >= 9 && currentZoom < 11.5) {
        // 10-11.5级：只显示板块多边形
        showBlocksOnly();
        hideProjectMarkers();
    } else if (currentZoom >= 11.5 && currentZoom < 14) {
        // 11.5-14级：显示板块名称 + 楼盘数量，隐藏新房点位
        showBlocksWithCount();
        hideProjectMarkers();
    } else if (currentZoom >= 14 && currentZoom <= 16.5) {
        // 14-18级：显示板块名称 + 新房点位（多边形最大显示到18级）
        showBlocksSmall();
        showProjectMarkers();
    } else if (currentZoom > 16.5 && currentZoom <= 20) {
        // 18级以上：只显示新房点位，隐藏板块多边形和标签
        hideBlockPolygons(); // 新增函数：隐藏板块多边形
        hideBlockLabels();
        showProjectMarkers();
    } else {
        // 其他级别：隐藏所有
        hideBlockLabels();
        hideProjectMarkers();
        hideBlockPolygons(); // 确保多边形也被隐藏
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
        // 不再直接初始化所有项目点，而是根据筛选刷新
        // initProjectMarkers();
        // 获取当前缩放级别并显示内容
        currentZoom = map.getZoom();
        // 根据当前筛选刷新地图
        refreshMapDisplay();
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
        // 创建多边形
        const polygon = new AMap.Polygon({
            path: block.coordinates,
            fillColor: block.color || '#FF6B6B',
            fillOpacity: block.opacity || 0.6,
            strokeColor: block.borderColor || '#FF5252',
            strokeWeight: 2,
            strokeOpacity: 0.8
        });

        // 获取中心点 - 优先使用预设，否则计算
        let center;
        if (block.center && block.center.length === 2) {
            center = block.center;
        } else {
            // 计算多边形坐标的平均值作为中心点
            const coords = block.coordinates;
            let sumLng = 0, sumLat = 0;
            coords.forEach(coord => {
                sumLng += coord[0];
                sumLat += coord[1];
            });
            center = [sumLng / coords.length, sumLat / coords.length];
        }

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
                'text-shadow': '1px 1px 1px #888888, -1px -1px 1px #888888, 1px -1px 1px #888888, -1px 1px 1px #888888',
                'user-select': 'none',
                '-webkit-user-select': 'none',
                '-moz-user-select': 'none',
                '-ms-user-select': 'none'
            }
        });

        blockPolygons.push(polygon);
        blockLabels.push(label);

        // 添加到地图
        map.add([polygon, label]);
    });
    
    console.log('板块多边形初始化完成，总数:', blockPolygons.length);
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
    });
}

// 显示信息窗
function showInfoWindow(project, marker) {
    const statusText = project.status === 'on-sale' ? '在售' : '待售';
    const statusClass = project.status;

    const content = `
        <div class="info-window" style="user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none;">
            <h3 style="user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none;">${project.name}</h3>
            <p class="price" style="user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none;">价格: ${project.price}</p>
            <p style="user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none;">面积: ${project.area}</p>
            <p style="user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none;">总价: ${project.totalPrice}</p>
            <span class="status ${statusClass}" style="user-select: none; -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none;">${statusText}</span>
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
    // 显示板块多边形
    blockPolygons.forEach((polygon, index) => {
        polygon.show();
    });

    // 显示板块标签，包含楼盘数量
    blockLabels.forEach((label, index) => {
        const block = blocksData[index];
        if (!block) {
            console.warn(`板块数据缺失，索引: ${index}`);
            return;
        }
        
        const count = getProjectCountInBlock(block);
        
        if (count > 0) {
            // 使用HTML内容实现不同颜色的文字
            const htmlContent = `
                <div style="
                    background-color: rgba(18, 203, 55, 0.8);
                    padding: 1px 4px;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: bold;
                    white-space: nowrap;
                    text-align: center;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
                    user-select: none;
                    -webkit-user-select: none;
                    -moz-user-select: none;
                    -ms-user-select: none;
                ">
                    <span style="color:rgb(237, 241, 245);">${block.name}</span>
                    <span style="color:rgb(250, 84, 13); margin-left: 0px;">${count}</span>
                </div>
            `;
            
            // 移除原来的标签
            if (label instanceof AMap.Marker) {
                map.remove(label);
            } else {
                map.remove(label);
            }
            
            // 创建新的Marker来显示HTML内容
            const marker = new AMap.Marker({
                position: label.getPosition(),
                content: htmlContent,
                anchor: 'center',
                offset: new AMap.Pixel(0, 0)
            });
            
            // 将新创建的marker添加到地图
            map.add(marker);
            
            // 将marker存储到blockLabels数组中，替换原来的对象
            blockLabels[index] = marker;
        } else {
            // 没有楼盘时只显示板块名称
            const htmlContent = `
                <div style="
                    background-color:rgba(18, 203, 55, 0.8);
                    padding: 1px 4px;
                    border-radius: 4px;
                    font-size: 12px;
                    font-weight: bold;
                    white-space: nowrap;
                    text-align: center;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
                    user-select: none;
                    -webkit-user-select: none;
                    -moz-user-select: none;
                    -ms-user-select: none;
                ">
                    <span style="color:rgb(237, 241, 245);">${block.name}</span>
                </div>
            `;
            
            // 移除原来的标签
            if (label instanceof AMap.Marker) {
                map.remove(label);
            } else {
                map.remove(label);
            }
            
            // 创建新的Marker来显示HTML内容
            const marker = new AMap.Marker({
                position: label.getPosition(),
                content: htmlContent,
                anchor: 'center',
                offset: new AMap.Pixel(0, 0)
            });
            
            // 将新创建的marker添加到地图
            map.add(marker);
            
            // 将marker存储到blockLabels数组中，替换原来的对象
            blockLabels[index] = marker;
        }
    });
}

// 显示小字体板块名称（14-18级）
function showBlocksSmall() {
    // 检查当前缩放级别，如果超过18级则不显示多边形
    if (currentZoom > 18) {
        hideBlockPolygons();
        hideBlockLabels();
        return;
    }
    
    // 显示板块多边形（仅在18级及以下）
    blockPolygons.forEach((polygon, index) => {
        polygon.show();
    });
    
    // 显示板块名称（小字体，只显示名称）
    blockLabels.forEach((label, index) => {
        const block = blocksData[index];
        if (!block) {
            console.warn(`板块数据缺失，索引: ${index}`);
            return;
        }
        
        if (label instanceof AMap.Marker) {
            // 如果是Marker对象，需要重新创建Text对象
            map.remove(label);
            
            // 创建新的Text标签
            const newLabel = new AMap.Text({
                text: block.name,
                position: label.getPosition(),
                anchor: 'center',
                style: {
                    'background-color': 'transparent',
                    'border': 'none',
                    'font-size': '12px',
                    'padding': '3px 6px',
                    'font-weight': 'bold',
                    'white-space': 'nowrap',
                    'text-align': 'center',
                    'color': '#ffffff',
                    'text-shadow': '1px 1px 1px #888888, -1px -1px 1px #888888, 1px -1px 1px #888888, -1px 1px 1px #888888',
                    'user-select': 'none',
                    '-webkit-user-select': 'none',
                    '-moz-user-select': 'none',
                    '-ms-user-select': 'none'
                }
            });
            
            map.add(newLabel);
            blockLabels[index] = newLabel;
        } else {
            // 如果是Text对象，直接设置文本和样式
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
                'text-shadow': '1px 1px 1px #888888, -1px -1px 1px #888888, 1px -1px 1px #888888, -1px 1px 1px #888888',
                'user-select': 'none',
                '-webkit-user-select': 'none',
                '-moz-user-select': 'none',
                '-ms-user-select': 'none'
            });
        }
    });
}

// 计算板块内的楼盘数量（根据当前筛选）
function getProjectCountInBlock(block) {
    let count = 0;
    const filteredProjects = getFilteredProjects();
    filteredProjects.forEach(project => {
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
        if (label instanceof AMap.Marker) {
            map.remove(label);
        } else {
            label.hide();
        }
    });
}

// 隐藏板块多边形
function hideBlockPolygons() {
    blockPolygons.forEach((polygon, index) => {
        polygon.hide();
    });
}

// 只显示板块多边形（10-11.5级）
function showBlocksOnly() {
    // 显示板块多边形
    blockPolygons.forEach((polygon, index) => {
        polygon.show();
    });
    
    // 隐藏所有标签
    blockLabels.forEach(label => {
        if (label instanceof AMap.Marker) {
            map.remove(label);
        } else {
            label.hide();
        }
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
function getFilteredProjects() {
    if (statusFilter === 'all') return projectsData;
    return projectsData.filter(p => p.status === statusFilter);
}

function searchProjects(query) {
    const filtered = getFilteredProjects();
    return filtered.filter(project => 
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
        // 新增：监听下拉框变化
        const statusSelect = document.getElementById('status-filter');
        if (statusSelect) {
            statusSelect.value = statusFilter;
            statusSelect.addEventListener('change', (e) => {
                statusFilter = e.target.value;
                refreshMapDisplay();
            });
        }
        
        console.log('深圳新房展示地图初始化完成');
    }, 100);
});

// ==================== 3D地图辅助功能 ====================

// 设置3D地图视角
function set3DView(pitch = 0, rotation = 0, animate = true) {
    if (!map) {
        console.error('地图未初始化');
        return;
    }
    
    if (animate) {
        map.setPitch(pitch, true);
        map.setRotation(rotation, true);
    } else {
        map.setPitch(pitch);
        map.setRotation(rotation);
    }
}

// 重置3D视角到默认状态
function reset3DView() {
    set3DView(0, 0, true);
}

// 获取当前3D视角信息
function get3DViewInfo() {
    if (!map) {
        console.error('地图未初始化');
        return null;
    }
    
    return {
        pitch: map.getPitch(),
        rotation: map.getRotation(),
        zoom: map.getZoom(),
        center: map.getCenter()
    };
}

// 切换到鸟瞰视角
function setBirdEyeView() {
    set3DView(70, 0, true);
}

// 切换到街景视角
function setStreetView() {
    set3DView(20, 0, true);
}

// 旋转地图一周（演示动画效果）
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

// 修改loadData和地图展示相关逻辑，确保只显示筛选后的项目
function refreshMapDisplay() {
    // 清除所有项目点
    hideProjectMarkers();
    // 重新生成projectMarkers
    projectMarkers = [];
    const filtered = getFilteredProjects();
    filtered.forEach((project, index) => {
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
        marker.on('click', () => {
            showInfoWindow(project, marker);
        });
        marker.on('dblclick', () => {
            if (project.url) {
                window.open(project.url, '_blank');
            }
        });
        projectMarkers.push(marker);
    });
    showProjectMarkers();
    onZoomChange(); // 重新触发缩放逻辑
} 