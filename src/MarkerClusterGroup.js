
/*
 * L.MarkerClusterGroup extends L.FeatureGroup by clustering the markers contained within
 */

L.MarkerClusterGroup = L.FeatureGroup.extend({

	options: {
		maxClusterRadius: 75, //A cluster will cover at most this many pixels from its center
		iconCreateFunction: null,

		spiderfyOnMaxZoom: true,
		showCoverageOnHover: true,
		zoomToBoundsOnClick: true,
		singleMarkerMode: false,

		disableClusteringAtZoom: null,

		// Setting this to false prevents the removal of any clusters outside of the viewpoint, which
		// is the default behaviour for performance reasons.
		removeOutsideVisibleBounds: true,

		//Whether to animate adding markers after adding the MarkerClusterGroup to the map
		// If you are adding individual markers set to true, if adding bulk markers leave false for massive performance gains.
		animateAddingMarkers: false,

		//Increase to increase the distance away that spiderfied markers appear from the center
		spiderfyDistanceMultiplier: 1,

		//Options to pass to the L.Polygon constructor
		polygonOptions: {},

		automaticUpdate: true
	},

	initialize: function (options) {
		L.Util.setOptions(this, options);
		if (!this.options.iconCreateFunction) {
			this.options.iconCreateFunction = this._defaultIconCreateFunction;
		}

		this._featureGroup = L.featureGroup();
		this._featureGroup.on(L.FeatureGroup.EVENTS, this._propagateEvent, this);

		this._nonPointGroup = L.featureGroup();
		this._nonPointGroup.on(L.FeatureGroup.EVENTS, this._propagateEvent, this);

		this._inZoomAnimation = 0;

		//The bounds of the currently shown area (from _getExpandedVisibleBounds) Updated on zoom/move
		this._zoom = 0;
		this._currentShownBounds = null;

		// List of layers, the key is the stamp of each layer
		this._layers = {};

		// The tree
		this._tree = null;

		// List of displayed MarkerClusters, the key is the position in a pixel grid
		this._displayedElements = {};

		// window.setTimeout reference for the automatic update
		// Set a fake reference if we don't want automatic updates
		this._updateTask = this.options.automaticUpdate ? 0 : 1;
	},

	addLayer: function (layer) {

		if (layer instanceof L.LayerGroup) {
			for (var i in layer._layers) {
				this.addLayer(layer._layers[i]);
			}
		}

		//Don't cluster non point data
		else if (!layer.getLatLng) {
			this._nonPointGroup.addLayer(layer);
		}

		else {
			// Add the layer to the dictionnary
			var id = L.stamp(layer);
			this._layers[id] = layer;

			this._callUpdateAndDisplay();
		}

		return this;
	},

	removeLayer: function (layer) {

		if (layer instanceof L.LayerGroup)
		{
			for (var i in layer._layers) {
				this.removeLayer(layer.layers[i]);
			}
		}

		//Non point layers
		else if (!layer.getLatLng) {
			this._nonPointGroup.removeLayer(layer);
		}

		// Remove the layer
		var id = L.stamp(layer);
		delete this._layers[id];

		if (this._featureGroup.hasLayer(layer)) {
			this._featureGroup.removeLayer(layer);
			if (layer.setOpacity) {
				layer.setOpacity(1);
			}
		}

		this._callUpdateAndDisplay();

		return this;
	},

	//Takes an array of markers and adds them in bulk
	addLayers: function (layersArray) {
		for (var i = 0, l = layersArray.length; i < l; i++) {
			this.addLayer(layersArray[i]);
		}

		return this;
	},

	//Takes an array of markers and removes them in bulk
	removeLayers: function (layersArray) {
		for (var i = 0, l = layersArray.length; i < l; i++) {
			this.removeLayer(layersArray[i]);
		}

		return this;
	},

	//Removes all layers from the MarkerClusterGroup
	clearLayers: function () {
		this._layers = {};

		return this;
	},

	//Override FeatureGroup.getBounds as it doesn't work
	getBounds: function () {
		var bounds = new L.LatLngBounds();

		if (this._tree) {
			bounds.extend(this._tree.bounds);
		}

		bounds.extend(this._nonPointGroup.getBounds());

		return bounds;
	},

	//Overrides LayerGroup.eachLayer
	eachLayer: function (method, context) {

		for (var keys = Object.keys(this._layers), i = 0, l = keys.length; i < l; ++i) {
			method.call(context, this._layers[keys[i]]);
		}

		this._nonPointGroup.eachLayer(method, context);
	},

	//Overrides LayerGroup.getLayers
	getLayers: function () {
		var layers = [];
		this.eachLayer(function (l) {
			layers.push(l);
		});
		return layers;
	},

	//Overrides LayerGroup.getLayer
	getLayer: function (id) {
		return this._layers[id] || null;
	},

	//Returns true if the given layer is in this MarkerClusterGroup
	hasLayer: function (layer) {
		return layer ? this._layers.hasOwnProperty(L.stamp(layer)) : false;
	},

	update: function () {
		var layers = [];
		for (var keys = Object.keys(this._layers), i = 0, l = keys.length; i < l; ++i) {
			var layer = this._layers[keys[i]];
			// Add a _treePosition property to the layer
			// It is like the _latLng property, but it's more generic
			layer._treePosition = layer.getLatLng();
			layers.push(layer);
		}

		this._tree = L.Tree.buildTree(layers);

		// this.display();
	},

	display: function () {
		if (this._unspiderfy) {
			this._unspiderfy();
		}

		var m;

		for (var keys = Object.keys(this._displayedElements),
			i = 0, l = keys.length; i < l; ++i) {
			m = this._displayedElements[keys[i]];
			this._map.removeLayer(m.display);
		}
		this._displayedElements = {};

		if (!this._tree || !this._currentShownBounds) {
			return;
		}

		var disableClusteringAtZoom =  this.options.disableClusteringAtZoom;
		if (disableClusteringAtZoom && this._map.getZoom() >= disableClusteringAtZoom) {
			console.log("ah");
			var leafs = this._tree.leafsInRange(this._currentShownBounds);
			console.log("bef");
			for (i = 0, l = leafs.length; i <  l; ++i) {
				var leaf = leafs[i];
				this._displayedElements[L.stamp(leaf)] = {display: leaf};
				this._map.addLayer(leaf);

			}
			return;
		}

		var dim = this._treeWidthAndHeight(this._tree.bounds);

		this._recursivelyManageBosques(this._tree, this._currentShownBounds, dim.width, dim.height);

		var singleMarkerMode = this.options.singleMarkerMode;


		for (keys = Object.keys(this._displayedElements),
			i = 0, l = keys.length; i < l; ++i) {
			m = this._displayedElements[keys[i]];
			if (m.count === 1 && m.leaf && !singleMarkerMode) {
				this._map.addLayer(m.leaf);
				m.display = m.leaf;
			} else {
				var cluster = new L.MarkerCluster(this, m, this._tree);
				this._featureGroup.addLayer(cluster);
				m.display = cluster;
			}
		}
	},

	_callUpdateAndDisplay: function () {
		if (!this._updateTask) {
			this._updateTask = window.setTimeout(L.bind(function () {
				this.update();
				this.display();
				this._updateTask = 0;
			}, this), 1);
		}
	},

	_treeWidthAndHeight: function (bounds) {
		var southWest = this._map.project(bounds.getSouthWest()),
			northEast = this._map.project(bounds.getNorthEast());

		return {
			width: northEast.x - southWest.x,
			height: southWest.y - northEast.y
		};
	},

	_addBosqueToScreen: function (tree) {
		var projection = this._map.project(tree.posAverage);

		var gridSize = this.options.maxClusterRadius;

		var x = projection.x - projection.x % gridSize,
			y = projection.y - projection.y % gridSize;

		var key = x + ":" + y;

		if (this._displayedElements.hasOwnProperty(key)) {
			console.log("hey ?");

			var oldTree = this._displayedElements[key];

			var newTree = {
				bounds: new L.LatLngBounds(),
				count: oldTree.count + tree.count,
				posAverage: new L.LatLng(oldTree.posAverage.lat, oldTree.posAverage.lng)
			};

			newTree.bounds.extend(oldTree.bounds);
			newTree.bounds.extend(tree.bounds);

			/* jshint debug:true*/
			// debugger;

			newTree.posAverage.lat = (oldTree.posAverage.lat * oldTree.count +
				tree.posAverage.lat * tree.count
				) / newTree.count;
			newTree.posAverage.lng = (oldTree.posAverage.lng * oldTree.count +
				tree.posAverage.lng * tree.count
				) / newTree.count;
			this._displayedElements[key] = newTree;
		} else {
			this._displayedElements[key] = tree;
		}
	},

	_recursivelyManageBosques: function (tree, bounds, width, height) {
		if (tree === null) {
			return;
		}

		var minSize = Math.floor(this.options.maxClusterRadius * 0.82);

		var projLeft,
			projRight,
			displayLeft = false,
			displayRight = false;

		// Check if the children can be displayed
		if (tree.left !== null && !tree.left._treePosition) {
			projLeft = this._treeWidthAndHeight(tree.left.bounds);
			displayLeft = projLeft.width >= minSize && projLeft.height >= minSize;
		}

		if (tree.right !== null && !tree.right._treePosition) {
			projRight = this._treeWidthAndHeight(tree.right.bounds);
			displayRight = projRight.width >= minSize && projRight.height >= minSize;
		}

		if (displayLeft && displayRight) {
			// TODO and me ? check if it's in the bounds
			// var b = {
			// 	count: 1,
			// 	leaf: tree.leaf,
			// 	bounds: new L.LatLngBounds(),
			// 	posAverage: new L.latLng(tree.leaf._treePosition.lat, tree.leaf._treePosition.lng)
			// };

			// b.bounds.extend(tree.leaf._treePosition);
			// b.bounds.extend(tree.left.bounds);

			// this._addBosqueToScreen(b);

			this._recursivelyManageBosques(tree.left, bounds, projLeft.width, projLeft.height);
			// this._recursivelyManageBosques(tree.left, bounds, projLeft.width, projLeft.height);
			this._recursivelyManageBosques(tree.right, bounds, projRight.width, projRight.height);
		} else {
			var divWidth = Math.max(Math.round(width / (minSize * 2)), 1),
				divHeight = Math.max(Math.round(height / (minSize * 2)), 1);

			// divWidth = 1;
			// divHeight = 1;

			if (divWidth > 1 || divHeight > 1) {

				var lngMax = tree.bounds._northEast.lng,
					lngMin = tree.bounds._southWest.lng,
					latMax = tree.bounds._northEast.lat,
					latMin = tree.bounds._southWest.lat;

				var dLng = (lngMax - lngMin) / divWidth,
					dLat = (latMax - latMin) / divHeight;

				for (var iLng = 0; iLng < divWidth; ++iLng) {
					for (var iLat = 0; iLat < divHeight; ++iLat) {
						var sectionLatMin = latMin + iLat * dLat,
							sectionLatMax = sectionLatMin + dLat,// - dLat,// * 0.001,
							sectionLngMin = lngMin + iLng * dLng,
							sectionLngMax = sectionLngMin + dLng;//- dLng;// * 0.001;

						if (sectionLatMin > bounds._northEast.lat) {
							break;
						}

						if (sectionLngMin > bounds._northEast.lng) {
							return;
						}

						var sectionBounds = new L.LatLngBounds();
						sectionBounds.extend(new L.LatLng(sectionLatMin, sectionLngMin));
						sectionBounds.extend(new L.LatLng(sectionLatMax, sectionLngMax));

						if (bounds.contains(sectionBounds) || bounds.intersects(sectionBounds)) {
							var bosque = tree.statsInRange(sectionBounds);

							if (bosque !== null && bosque.count > 0) {

								this._addBosqueToScreen(bosque);
							}
						}
					}
				}

			} else {
				// this._addBosqueToScreen(tree);
				this._addBosqueToScreen(tree.statsInRange(tree.bounds));
			}
		}
	},

	//Zoom down to show the given layer (spiderfying if necessary) then calls the callback
	zoomToShowLayer: function (layer, callback) {

		var showMarker = function () {
			if ((layer._icon || layer.__parent._icon) && !this._inZoomAnimation) {
				this._map.off('moveend', showMarker, this);
				this.off('animationend', showMarker, this);

				if (layer._icon) {
					callback();
				} else if (layer.__parent._icon) {
					var afterSpiderfy = function () {
						this.off('spiderfied', afterSpiderfy, this);
						callback();
					};

					this.on('spiderfied', afterSpiderfy, this);
					layer.__parent.spiderfy();
				}
			}
		};

		if (layer._icon && this._map.getBounds().contains(layer.getLatLng())) {
			callback();
		} else {
			console.log("TODO");
		}
		// } else if (layer.__parent._zoom < this._map.getZoom()) {
		// 	//Layer should be visible now but isn't on screen, just pan over to it
		// 	this._map.on('moveend', showMarker, this);
		// 	this._map.panTo(layer.getLatLng());
		// } else {
		// 	this._map.on('moveend', showMarker, this);
		// 	this.on('animationend', showMarker, this);
		// 	this._map.setView(layer.getLatLng(), layer.__parent._zoom + 1);
		// 	layer.__parent.zoomToBounds();
		// }
	},

	//Overrides FeatureGroup.onAdd
	onAdd: function (map) {
		this._map = map;

		if (!isFinite(this._map.getMaxZoom())) {
			throw "Map has no maxZoom specified";
		}

		this._featureGroup.onAdd(map);
		this._nonPointGroup.onAdd(map);

		this._map.on('zoomend', this._zoomEnd, this);
		this._map.on('moveend', this._moveEnd, this);

		this._bindEvents();

		this.update();
		this._zoom = this._map.getZoom();
		this._currentShownBounds = this._getExpandedVisibleBounds();
		this.display();
	},

	//Overrides FeatureGroup.onRemove
	onRemove: function (map) {
		map.off('zoomend', this._zoomEnd, this);
		map.off('moveend', this._moveEnd, this);

		this._unbindEvents();

		//In case we are in a cluster animation
		this._map._mapPane.className = this._map._mapPane.className.replace(' leaflet-cluster-anim', '');

		//Clean up all the layers we added to the map
		this._hideCoverage();
		this._featureGroup.onRemove(map);
		this._nonPointGroup.onRemove(map);

		this._featureGroup.clearLayers();

		this._map = null;
	},

	// TODO ADD IT LATER
	getVisibleParent: function (/*marker*/) {
		// var vMarker = marker;
		// while (vMarker && !vMarker._icon) {
		// 	vMarker = vMarker.__parent;
		// }
		// return vMarker || null;
	},

	//Remove the given object from the given array
	_arraySplice: function (anArray, obj) {
		for (var i = anArray.length - 1; i >= 0; i--) {
			if (anArray[i] === obj) {
				anArray.splice(i, 1);
				return true;
			}
		}
	},


	_isOrIsParent: function (el, oel) {
		while (oel) {
			if (el === oel) {
				return true;
			}
			oel = oel.parentNode;
		}
		return false;
	},

	_propagateEvent: function (e) {
		if (e.layer instanceof L.MarkerCluster) {
			//Prevent multiple clustermouseover/off events if the icon is made up of stacked divs (Doesn't work in ie <= 8, no relatedTarget)
			if (e.originalEvent && this._isOrIsParent(e.layer._icon, e.originalEvent.relatedTarget)) {
				return;
			}
			e.type = 'cluster' + e.type;
		}

		this.fire(e.type, e);
	},

	//Default functionality
	_defaultIconCreateFunction: function (cluster) {
		var childCount = cluster.getChildCount();

		var c = ' marker-cluster-';
		if (childCount < 10) {
			c += 'small';
		} else if (childCount < 100) {
			c += 'medium';
		} else {
			c += 'large';
		}

		return new L.DivIcon({ html: '<div><span>' + childCount + '</span></div>', className: 'marker-cluster' + c, iconSize: new L.Point(40, 40) });
	},

	_bindEvents: function () {
		var map = this._map,
			spiderfyOnMaxZoom = this.options.spiderfyOnMaxZoom,
			showCoverageOnHover = this.options.showCoverageOnHover,
			zoomToBoundsOnClick = this.options.zoomToBoundsOnClick;

		//Zoom on cluster click or spiderfy if we are at the lowest level
		if (spiderfyOnMaxZoom || zoomToBoundsOnClick) {
			this.on('clusterclick', this._zoomOrSpiderfy, this);
		}

		//Show convex hull (boundary) polygon on mouse over
		if (showCoverageOnHover) {
			this.on('clustermouseover', this._showCoverage, this);
			this.on('clustermouseout', this._hideCoverage, this);
			map.on('zoomend', this._hideCoverage, this);
		}
	},

	_zoomOrSpiderfy: function (e) {
		var map = this._map;
		if (map.getMaxZoom() === map.getZoom()) {
			if (this.options.spiderfyOnMaxZoom) {
				e.layer.spiderfy();
			}
		} else if (this.options.zoomToBoundsOnClick) {
			e.layer.zoomToBounds();
		}

		// Focus the map again for keyboard users. 
		// /!\ ISSUES WITH iSCROLL ?
		if (e.originalEvent && e.originalEvent.keyCode === 13) {
			map._container.focus();
		}
	},

	_showCoverage: function (e) {
		var map = this._map;
		if (this._inZoomAnimation) {
			return;
		}
		if (this._shownPolygon) {
			map.removeLayer(this._shownPolygon);
		}
		if (/*e.layer.getChildCount() > 2 && */e.layer !== this._spiderfied) {
			this._shownPolygon = new L.Polygon(e.layer.getConvexHull(), this.options.polygonOptions);
			map.addLayer(this._shownPolygon);
		}
	},

	_hideCoverage: function () {
		if (this._shownPolygon) {
			this._map.removeLayer(this._shownPolygon);
			this._shownPolygon = null;
		}
	},

	_unbindEvents: function () {
		var spiderfyOnMaxZoom = this.options.spiderfyOnMaxZoom,
			showCoverageOnHover = this.options.showCoverageOnHover,
			zoomToBoundsOnClick = this.options.zoomToBoundsOnClick,
			map = this._map;

		if (spiderfyOnMaxZoom || zoomToBoundsOnClick) {
			this.off('clusterclick', this._zoomOrSpiderfy, this);
		}
		if (showCoverageOnHover) {
			this.off('clustermouseover', this._showCoverage, this);
			this.off('clustermouseout', this._hideCoverage, this);
			map.off('zoomend', this._hideCoverage, this);
		}
	},

	_zoomEnd: function () {
		if (!this._map) { //May have been removed from the map by a zoomEnd handler
			return;
		}
		// this._mergeSplitClusters(); // TODO

		this._zoom = this._map._zoom;
		this._currentShownBounds = this._getExpandedVisibleBounds();

		this.display();
	},

	_moveEnd: function () {
		if (this._inZoomAnimation) {
			return;
		}

		var newBounds = this._getExpandedVisibleBounds();

		// this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, this._zoom, newBounds);
		// this._topClusterLevel._recursivelyAddChildrenToMap(null, this._map._zoom, newBounds);

		this._currentShownBounds = newBounds;
		this.display();

		// TODO UPDATE VIEW HERE
		return;
	},

	//Enqueue code to fire after the marker expand/contract has happened
	_enqueue: function (fn) {
		this._queue.push(fn);
		if (!this._queueTimeout) {
			this._queueTimeout = setTimeout(L.bind(this._processQueue, this), 300);
		}
	},
	_processQueue: function () {
		for (var i = 0; i < this._queue.length; i++) {
			this._queue[i].call(this);
		}
		this._queue.length = 0;
		clearTimeout(this._queueTimeout);
		this._queueTimeout = null;
	},

	//Merge and split any existing clusters that are too big or small
	/*_mergeSplitClusters: function () {

		//Incase we are starting to split before the animation finished
		this._processQueue();

		if (this._zoom < this._map._zoom && this._currentShownBounds.contains(this._getExpandedVisibleBounds())) { //Zoom in, split
			this._animationStart();
			//Remove clusters now off screen
			this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, this._zoom, this._getExpandedVisibleBounds());

			this._animationZoomIn(this._zoom, this._map._zoom);

		} else if (this._zoom > this._map._zoom) { //Zoom out, merge
			this._animationStart();

			this._animationZoomOut(this._zoom, this._map._zoom);
		} else {
			this._moveEnd();
		}
	},*/

	//Gets the maps visible bounds expanded in each direction by the size of the screen (so the user cannot see an area we do not cover in one pan)
	_getExpandedVisibleBounds: function () {
		if (!this.options.removeOutsideVisibleBounds) {
			return this.getBounds();
		}

		var map = this._map,
			bounds = map.getBounds(),
			sw = bounds._southWest,
			ne = bounds._northEast,
			latDiff = L.Browser.mobile ? 0 : Math.abs(sw.lat - ne.lat),
			lngDiff = L.Browser.mobile ? 0 : Math.abs(sw.lng - ne.lng);

		return new L.LatLngBounds(
			new L.LatLng(sw.lat - latDiff, sw.lng - lngDiff, true),
			new L.LatLng(ne.lat + latDiff, ne.lng + lngDiff, true));
	}//,

	// //Shared animation code
	// _animationAddLayerNonAnimated: function (layer, newCluster) {
	// 	if (newCluster === layer) {
	// 		this._featureGroup.addLayer(layer);
	// 	} else if (newCluster._childCount === 2) {
	// 		newCluster._addToMap();

	// 		var markers = newCluster.getAllChildMarkers();
	// 		this._featureGroup.removeLayer(markers[0]);
	// 		this._featureGroup.removeLayer(markers[1]);
	// 	} else {
	// 		newCluster._updateIcon();
	// 	}
	// }
});

L.MarkerClusterGroup.include(!L.DomUtil.TRANSITION ? {

	//Non Animated versions of everything
	_animationStart: function () {
		//Do nothing...
	},
	_animationZoomIn: function (previousZoomLevel, newZoomLevel) {
		this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel);
		this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
	},
	_animationZoomOut: function (previousZoomLevel, newZoomLevel) {
		this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel);
		this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
	},
	_animationAddLayer: function (layer, newCluster) {
		this._animationAddLayerNonAnimated(layer, newCluster);
	}
} : {

	//Animated versions here
	_animationStart: function () {
		this._map._mapPane.className += ' leaflet-cluster-anim';
		this._inZoomAnimation++;
	},
	_animationEnd: function () {
		if (this._map) {
			this._map._mapPane.className = this._map._mapPane.className.replace(' leaflet-cluster-anim', '');
		}
		this._inZoomAnimation--;
		this.fire('animationend');
	},
	_animationZoomIn: function (previousZoomLevel, newZoomLevel) {
		var bounds = this._getExpandedVisibleBounds(),
			fg = this._featureGroup,
			i;

		//Add all children of current clusters to map and remove those clusters from map
		this._topClusterLevel._recursively(bounds, previousZoomLevel, 0, function (c) {
			var startPos = c._latlng,
				markers = c._markers,
				m;

			if (!bounds.contains(startPos)) {
				startPos = null;
			}

			if (c._isSingleParent() && previousZoomLevel + 1 === newZoomLevel) { //Immediately add the new child and remove us
				fg.removeLayer(c);
				c._recursivelyAddChildrenToMap(null, newZoomLevel, bounds);
			} else {
				//Fade out old cluster
				c.setOpacity(0);
				c._recursivelyAddChildrenToMap(startPos, newZoomLevel, bounds);
			}

			//Remove all markers that aren't visible any more
			//TODO: Do we actually need to do this on the higher levels too?
			for (i = markers.length - 1; i >= 0; i--) {
				m = markers[i];
				if (!bounds.contains(m._latlng)) {
					fg.removeLayer(m);
				}
			}

		});

		this._forceLayout();

		//Update opacities
		this._topClusterLevel._recursivelyBecomeVisible(bounds, newZoomLevel);
		//TODO Maybe? Update markers in _recursivelyBecomeVisible
		fg.eachLayer(function (n) {
			if (!(n instanceof L.MarkerCluster) && n._icon) {
				n.setOpacity(1);
			}
		});

		//update the positions of the just added clusters/markers
		this._topClusterLevel._recursively(bounds, previousZoomLevel, newZoomLevel, function (c) {
			c._recursivelyRestoreChildPositions(newZoomLevel);
		});

		//Remove the old clusters and close the zoom animation
		this._enqueue(function () {
			//update the positions of the just added clusters/markers
			this._topClusterLevel._recursively(bounds, previousZoomLevel, 0, function (c) {
				fg.removeLayer(c);
				c.setOpacity(1);
			});

			this._animationEnd();
		});
	},

	_animationZoomOut: function (previousZoomLevel, newZoomLevel) {
		this._animationZoomOutSingle(this._topClusterLevel, previousZoomLevel - 1, newZoomLevel);

		//Need to add markers for those that weren't on the map before but are now
		this._topClusterLevel._recursivelyAddChildrenToMap(null, newZoomLevel, this._getExpandedVisibleBounds());
		//Remove markers that were on the map before but won't be now
		this._topClusterLevel._recursivelyRemoveChildrenFromMap(this._currentShownBounds, previousZoomLevel, this._getExpandedVisibleBounds());
	},
	_animationZoomOutSingle: function (cluster, previousZoomLevel, newZoomLevel) {
		var bounds = this._getExpandedVisibleBounds();

		//Animate all of the markers in the clusters to move to their cluster center point
		cluster._recursivelyAnimateChildrenInAndAddSelfToMap(bounds, previousZoomLevel + 1, newZoomLevel);

		var me = this;

		//Update the opacity (If we immediately set it they won't animate)
		this._forceLayout();
		cluster._recursivelyBecomeVisible(bounds, newZoomLevel);

		//TODO: Maybe use the transition timing stuff to make this more reliable
		//When the animations are done, tidy up
		this._enqueue(function () {

			//This cluster stopped being a cluster before the timeout fired
			if (cluster._childCount === 1) {
				var m = cluster._markers[0];
				//If we were in a cluster animation at the time then the opacity and position of our child could be wrong now, so fix it
				m.setLatLng(m.getLatLng());
				if (m.setOpacity) {
					m.setOpacity(1);
				}
			} else {
				cluster._recursively(bounds, newZoomLevel, 0, function (c) {
					c._recursivelyRemoveChildrenFromMap(bounds, previousZoomLevel + 1);
				});
			}
			me._animationEnd();
		});
	},
	_animationAddLayer: function (layer, newCluster) {
		var me = this,
			fg = this._featureGroup;

		fg.addLayer(layer);
		if (newCluster !== layer) {
			if (newCluster._childCount > 2) { //Was already a cluster

				newCluster._updateIcon();
				this._forceLayout();
				this._animationStart();

				layer._setPos(this._map.latLngToLayerPoint(newCluster.getLatLng()));
				layer.setOpacity(0);

				this._enqueue(function () {
					fg.removeLayer(layer);
					layer.setOpacity(1);

					me._animationEnd();
				});

			} else { //Just became a cluster
				this._forceLayout();

				me._animationStart();
				me._animationZoomOutSingle(newCluster, this._map.getMaxZoom(), this._map.getZoom());
			}
		}
	},

	//Force a browser layout of stuff in the map
	// Should apply the current opacity and location to all elements so we can update them again for an animation
	_forceLayout: function () {
		//In my testing this works, infact offsetWidth of any element seems to work.
		//Could loop all this._layers and do this for each _icon if it stops working

		L.Util.falseFn(document.body.offsetWidth);
	}
});

L.markerClusterGroup = function (options) {
	return new L.MarkerClusterGroup(options);
};

L.LatLngBounds.prototype.extend = function (obj) { // (LatLng) or (LatLngBounds)
	var southWest = this._southWest,
		northEast = this._northEast,
		newSouthWest, newNorthEast;

	if (obj instanceof L.LatLng) {
		newSouthWest = obj;
		newNorthEast = obj;
	} else if (obj instanceof L.LatLngBounds) {
		newSouthWest = obj._southWest;
		newNorthEast = obj._northEast;

		if (!newSouthWest || !newNorthEast) {
			return this;
		}
	} else if (obj) {
		var latLng = L.latLng(obj);
		if (latLng !== null) {
			this.extend(latLng);
		} else {
			var latLngBounds = L.latLngBounds(obj);
			if (latLngBounds !== null) {
				this.extend(latLngBounds);
			}
		}

		return this;
	}
	else {
		return this;
	}

	if (!southWest && !northEast) {
		this._southWest = new L.LatLng(newSouthWest.lat, newSouthWest.lng);
		this._northEast = new L.LatLng(newNorthEast.lat, newNorthEast.lng);
	} else {
		southWest.lat = Math.min(newSouthWest.lat, southWest.lat);
		southWest.lng = Math.min(newSouthWest.lng, southWest.lng);
		northEast.lat = Math.max(newNorthEast.lat, northEast.lat);
		northEast.lng = Math.max(newNorthEast.lng, northEast.lng);
	}

	return this;
};