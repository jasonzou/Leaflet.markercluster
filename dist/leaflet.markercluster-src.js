/*
 Leaflet.markercluster, Provides Beautiful Animated Marker Clustering functionality for Leaflet, a JS library for interactive maps.
 https://github.com/Leaflet/Leaflet.markercluster
 (c) 2012-2013, Dave Leaver, smartrak
*/
(function (window, document, undefined) {
/*
 * L.MarkerClusterGroup extends L.FeatureGroup by clustering the markers contained within
 */

L.MarkerClusterGroup = L.FeatureGroup.extend({

	options: {
		maxClusterRadius: 80, //A cluster will cover at most this many pixels from its center
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

		var minSize = Math.floor(this.options.maxClusterRadius * 0.85);

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

L.MarkerCluster = L.Marker.extend({
	initialize: function (group, tree, root) {

		L.Marker.prototype.initialize.call(this, tree.posAverage, { icon: this });


		this._count = tree.count;
		this._group = group;
		this._tree = tree;
		this._root = root;

		// this._markers = [];
		// this._childClusters = [];
		// this._childCount = tree.count;
		this._iconNeedsUpdate = true;

		this._bounds = tree.bounds;
	},

	//Recursively retrieve all child markers of this cluster
	getAllChildMarkers: function () {
		return this._root.leafsInRange(this._bounds);
		// storageArray = storageArray || [];

		// for (var i = this._childClusters.length - 1; i >= 0; i--) {
		// 	this._childClusters[i].getAllChildMarkers(storageArray);
		// }

		// for (var j = this._markers.length - 1; j >= 0; j--) {
		// 	storageArray.push(this._markers[j]);
		// }

		// return storageArray;
	},

	//Returns the count of how many child markers we have
	getChildCount: function () {
		return this._count;
	},

	//Zoom to the minimum of showing all of the child markers, or the extents of this cluster
	zoomToBounds: function () {
		// var childClusters = this._childClusters.slice(),
		var map = this._group._map,
			boundsZoom = map.getBoundsZoom(this._bounds),
			// zoom = this._zoom + 1,
			mapZoom = map.getZoom();
			// i;

		// //calculate how fare we need to zoom down to see all of the markers
		// while (childClusters.length > 0 && boundsZoom > zoom) {
		// 	zoom++;
		// 	var newClusters = [];
		// 	for (i = 0; i < childClusters.length; i++) {
		// 		newClusters = newClusters.concat(childClusters[i]._childClusters);
		// 	}
		// 	childClusters = newClusters;
		// }

		// if (boundsZoom > zoom) {
		// 	this._group._map.setView(this._latlng, zoom);
		if (boundsZoom <= mapZoom) { //If fitBounds wouldn't zoom us down, zoom us down instead
			this._group._map.setView(this._latlng, mapZoom + 1);
		} else {
			this._group._map.fitBounds(this._bounds);
		}
	},

	getBounds: function () {
		var bounds = new L.LatLngBounds();
		bounds.extend(this._bounds);
		return bounds;
	},

	_updateIcon: function () {
		this._iconNeedsUpdate = true;
		if (this._icon) {
			this.setIcon(this);
		}
	},

	//Cludge for Icon, we pretend to be an icon for performance
	createIcon: function () {
		if (this._iconNeedsUpdate) {
			this._iconObj = this._group.options.iconCreateFunction(this);
			this._iconNeedsUpdate = false;
		}
		return this._iconObj.createIcon();
	},
	createShadow: function () {
		return this._iconObj.createShadow();
	},


	_addChild: function (new1, isNotificationFromChild) {

		this._iconNeedsUpdate = true;
		this._expandBounds(new1);

		if (new1 instanceof L.MarkerCluster) {
			if (!isNotificationFromChild) {
				this._childClusters.push(new1);
				new1.__parent = this;
			}
			this._childCount += new1._childCount;
		} else {
			if (!isNotificationFromChild) {
				this._markers.push(new1);
			}
			this._childCount++;
		}

		if (this.__parent) {
			this.__parent._addChild(new1, true);
		}
	},

	//Expand our bounds and tell our parent to
	_expandBounds: function (marker) {
		var addedCount,
		    addedLatLng = marker._wLatLng || marker._latlng;

		if (marker instanceof L.MarkerCluster) {
			this._bounds.extend(marker._bounds);
			addedCount = marker._childCount;
		} else {
			this._bounds.extend(addedLatLng);
			addedCount = 1;
		}

		if (!this._cLatLng) {
			// when clustering, take position of the first point as the cluster center
			this._cLatLng = marker._cLatLng || addedLatLng;
		}

		// when showing clusters, take weighted average of all points as cluster center
		var totalCount = this._childCount + addedCount;

		//Calculate weighted latlng for display
		if (!this._wLatLng) {
			this._latlng = this._wLatLng = new L.LatLng(addedLatLng.lat, addedLatLng.lng);
		} else {
			this._wLatLng.lat = (addedLatLng.lat * addedCount + this._wLatLng.lat * this._childCount) / totalCount;
			this._wLatLng.lng = (addedLatLng.lng * addedCount + this._wLatLng.lng * this._childCount) / totalCount;
		}
	},

	//Set our markers position as given and add it to the map
	_addToMap: function (startPos) {
		if (startPos) {
			this._backupLatlng = this._latlng;
			this.setLatLng(startPos);
		}
		this._group._featureGroup.addLayer(this);
	},

	_recursivelyAnimateChildrenIn: function (bounds, center, maxZoom) {
		this._recursively(bounds, 0, maxZoom - 1,
			function (c) {
				var markers = c._markers,
					i, m;
				for (i = markers.length - 1; i >= 0; i--) {
					m = markers[i];

					//Only do it if the icon is still on the map
					if (m._icon) {
						m._setPos(center);
						m.setOpacity(0);
					}
				}
			},
			function (c) {
				var childClusters = c._childClusters,
					j, cm;
				for (j = childClusters.length - 1; j >= 0; j--) {
					cm = childClusters[j];
					if (cm._icon) {
						cm._setPos(center);
						cm.setOpacity(0);
					}
				}
			}
		);
	},

	_recursivelyAnimateChildrenInAndAddSelfToMap: function (bounds, previousZoomLevel, newZoomLevel) {
		this._recursively(bounds, newZoomLevel, 0,
			function (c) {
				c._recursivelyAnimateChildrenIn(bounds, c._group._map.latLngToLayerPoint(c.getLatLng()).round(), previousZoomLevel);

				//TODO: depthToAnimateIn affects _isSingleParent, if there is a multizoom we may/may not be.
				//As a hack we only do a animation free zoom on a single level zoom, if someone does multiple levels then we always animate
				if (c._isSingleParent() && previousZoomLevel - 1 === newZoomLevel) {
					c.setOpacity(1);
					c._recursivelyRemoveChildrenFromMap(bounds, previousZoomLevel); //Immediately remove our children as we are replacing them. TODO previousBounds not bounds
				} else {
					c.setOpacity(0);
				}

				c._addToMap();
			}
		);
	},

	_recursivelyBecomeVisible: function (bounds, zoomLevel) {
		this._recursively(bounds, 0, zoomLevel, null, function (c) {
			c.setOpacity(1);
		});
	},

	_recursivelyAddChildrenToMap: function (startPos, zoomLevel, bounds) {
		this._recursively(bounds, -1, zoomLevel,
			function (c) {
				if (zoomLevel === c._zoom) {
					return;
				}

				//Add our child markers at startPos (so they can be animated out)
				for (var i = c._markers.length - 1; i >= 0; i--) {
					var nm = c._markers[i];

					if (!bounds.contains(nm._latlng)) {
						continue;
					}

					if (startPos) {
						nm._backupLatlng = nm.getLatLng();

						nm.setLatLng(startPos);
						if (nm.setOpacity) {
							nm.setOpacity(0);
						}
					}

					c._group._featureGroup.addLayer(nm);
				}
			},
			function (c) {
				c._addToMap(startPos);
			}
		);
	},

	_recursivelyRestoreChildPositions: function (zoomLevel) {
		//Fix positions of child markers
		for (var i = this._markers.length - 1; i >= 0; i--) {
			var nm = this._markers[i];
			if (nm._backupLatlng) {
				nm.setLatLng(nm._backupLatlng);
				delete nm._backupLatlng;
			}
		}

		if (zoomLevel - 1 === this._zoom) {
			//Reposition child clusters
			for (var j = this._childClusters.length - 1; j >= 0; j--) {
				this._childClusters[j]._restorePosition();
			}
		} else {
			for (var k = this._childClusters.length - 1; k >= 0; k--) {
				this._childClusters[k]._recursivelyRestoreChildPositions(zoomLevel);
			}
		}
	},

	_restorePosition: function () {
		if (this._backupLatlng) {
			this.setLatLng(this._backupLatlng);
			delete this._backupLatlng;
		}
	},

	//exceptBounds: If set, don't remove any markers/clusters in it
	_recursivelyRemoveChildrenFromMap: function (previousBounds, zoomLevel, exceptBounds) {
		var m, i;
		this._recursively(previousBounds, -1, zoomLevel - 1,
			function (c) {
				//Remove markers at every level
				for (i = c._markers.length - 1; i >= 0; i--) {
					m = c._markers[i];
					if (!exceptBounds || !exceptBounds.contains(m._latlng)) {
						c._group._featureGroup.removeLayer(m);
						if (m.setOpacity) {
							m.setOpacity(1);
						}
					}
				}
			},
			function (c) {
				//Remove child clusters at just the bottom level
				for (i = c._childClusters.length - 1; i >= 0; i--) {
					m = c._childClusters[i];
					if (!exceptBounds || !exceptBounds.contains(m._latlng)) {
						c._group._featureGroup.removeLayer(m);
						if (m.setOpacity) {
							m.setOpacity(1);
						}
					}
				}
			}
		);
	},

	//Run the given functions recursively to this and child clusters
	// boundsToApplyTo: a L.LatLngBounds representing the bounds of what clusters to recurse in to
	// zoomLevelToStart: zoom level to start running functions (inclusive)
	// zoomLevelToStop: zoom level to stop running functions (inclusive)
	// runAtEveryLevel: function that takes an L.MarkerCluster as an argument that should be applied on every level
	// runAtBottomLevel: function that takes an L.MarkerCluster as an argument that should be applied at only the bottom level
	_recursively: function (boundsToApplyTo, zoomLevelToStart, zoomLevelToStop, runAtEveryLevel, runAtBottomLevel) {
		var childClusters = this._childClusters,
		    zoom = this._zoom,
			i, c;

		if (zoomLevelToStart > zoom) { //Still going down to required depth, just recurse to child clusters
			for (i = childClusters.length - 1; i >= 0; i--) {
				c = childClusters[i];
				if (boundsToApplyTo.intersects(c._bounds)) {
					c._recursively(boundsToApplyTo, zoomLevelToStart, zoomLevelToStop, runAtEveryLevel, runAtBottomLevel);
				}
			}
		} else { //In required depth

			if (runAtEveryLevel) {
				runAtEveryLevel(this);
			}
			if (runAtBottomLevel && this._zoom === zoomLevelToStop) {
				runAtBottomLevel(this);
			}

			//TODO: This loop is almost the same as above
			if (zoomLevelToStop > zoom) {
				for (i = childClusters.length - 1; i >= 0; i--) {
					c = childClusters[i];
					if (boundsToApplyTo.intersects(c._bounds)) {
						c._recursively(boundsToApplyTo, zoomLevelToStart, zoomLevelToStop, runAtEveryLevel, runAtBottomLevel);
					}
				}
			}
		}
	},

	_recalculateBounds: function () {
		var markers = this._markers,
			childClusters = this._childClusters,
			i;

		this._bounds = new L.LatLngBounds();
		delete this._wLatLng;

		for (i = markers.length - 1; i >= 0; i--) {
			this._expandBounds(markers[i]);
		}
		for (i = childClusters.length - 1; i >= 0; i--) {
			this._expandBounds(childClusters[i]);
		}
	},


	//Returns true if we are the parent of only one cluster and that cluster is the same as us
	_isSingleParent: function () {
		//Don't need to check this._markers as the rest won't work if there are any
		return this._childClusters.length > 0 && this._childClusters[0]._childCount === this._childCount;
	}
});



L.Tree = function (dimension) {
	this.left = null;
	this.right = null;
	this.count = 0;
	this.dimension = dimension;
	this.bounds = null;
	this.posAverage = new L.LatLng(0.0, 0.0);
};

L.Tree.prototype = {



	updateInformations: function () {
		this.count = 0;
		this.posAverage.lat = 0.0;
		this.posAverage.lng = 0.0;
		this.bounds = new L.LatLngBounds();

		if (this.left !== null) {
			if (this.left._treePosition) {
				L.Tree._applyInformations(this, 1, this.left._treePosition, this.left._treePosition);
			} else {
				L.Tree._applyInformations(this, this.left.count, this.left.posAverage, this.left.bounds);
			}
		}

		if (this.right !== null) {
			if (this.right._treePosition) {
				L.Tree._applyInformations(this, 1, this.right._treePosition, this.right._treePosition);
			} else {
				L.Tree._applyInformations(this, this.right.count, this.right.posAverage, this.right.bounds);
			}
		}
	},

	allLeafs: function (leafs) {
		leafs = leafs || [];

		if (this.left !== null) {
			if (this.left._treePosition) {
				leafs.push(this.left);
			} else {
				this.left.allLeafs(leafs);
			}
		}

		if (this.right !== null) {
			if (this.right._treePosition) {
				leafs.push(this.right);
			} else {
				this.right.allLeafs(leafs);
			}
		}
	},

	leafsInRange: function (range, leafs) {
		leafs = leafs || [];

		if (range.contains(this.bounds)) {
			this.allLeafs(leafs);
		} else if (range.intersects(this.bounds)) {
			if (this.left !== null) {
				if (this.left._treePosition) {
					if (range.contains(this.left._treePosition)) {
						leafs.push(this.left);
					}
				} else {
					this.left.leafsInRange(range, leafs);
				}
			}

			if (this.right !== null) {
				if (this.right._treePosition) {
					if (range.contains(this.right._treePosition)) {
						leafs.push(this.right);
					}
				} else {
					this.right.leafsInRange(range, leafs);
				}
			}
		}

		return leafs;
	},

	statsInRange: function (range) {

		var bosque;
		if (range.contains(this.bounds)) {
			bosque = {
				count: this.count,
				bounds: new L.LatLngBounds(),
				posAverage: new L.LatLng(this.posAverage.lat, this.posAverage.lng)
			};

			if (this.count === 1) {
				if (this.left !== null && this.left._treePosition) {
					bosque.leaf = this.left;
				}
				else if (this.right !== null && this.right._treePosition) {
					bosque.leaf = this.right;
				}
			}
			bosque.bounds.extend(this.bounds);

			return bosque;

		} else if (range.intersects(this.bounds)) {
			bosque = {
				count: 0,
				bounds: new L.LatLngBounds(),
				posAverage: new L.LatLng(0.0, 0.0)
			};

			var leaf = null;

			if (this.left !== null) {
				if (this.left._treePosition) {
					if (range.contains(this.left._treePosition)) {
						L.Tree._applyInformations(bosque, 1, this.left._treePosition, this.left._treePosition);
		
						leaf = this.left;
					}
				} else {
					var bosqueLeft = this.left.statsInRange(range);

					if (bosqueLeft !== null && bosqueLeft.count > 0) {
						L.Tree._applyInformations(bosque, bosqueLeft.count, bosqueLeft.posAverage, bosqueLeft.bounds);

						if (bosqueLeft.leaf) {
							leaf = bosqueLeft.leaf;
						}
					}
				}
			}

			if (this.right !== null) {
				if (this.right._treePosition) {
					if (range.contains(this.right._treePosition)) {
						L.Tree._applyInformations(bosque, 1, this.right._treePosition, this.right._treePosition);

						leaf = this.right;
					}
				} else {
					var bosqueRight = this.right.statsInRange(range);

					if (bosqueRight !== null && bosqueRight.count > 0) {
						L.Tree._applyInformations(bosque, bosqueRight.count, bosqueRight.posAverage, bosqueRight.bounds);

						if (bosqueRight.leaf) {
							leaf = bosqueRight.leaf;
						}
					}
				}
			}

			if (bosque.count === 1) {
				bosque.leaf = leaf;
			}

			return bosque;
		} else {
			return null;
		}
	}
};


L.Tree.buildTree = function (leafs, dimension) {
	var length = leafs.length;

	if (length === 0) {
		return null;
	}

	// TODO CHECK IF THIS IS USELESS
	// if (length === 1) {
	// 	return leafs[0];
	// }

	// 0 : Lat, 1 : Lng
	/*jshint bitwise: false*/
	dimension = (dimension|0) % 2;

	// Sort the leafs with the latitude or longitude
	// The method is cached for better performances
	leafs.sort(L.Tree._compareMethods[dimension]);

	// Cut the list in two equal parts
	var median = Math.floor(length / 2);
	
	var node = new L.Tree(dimension);

	// Optimized recursivity
	if (median > 0) {
		if (median > 1) {
			node.left = L.Tree.buildTree(leafs.slice(0, median), dimension + 1);
		} else {
			node.left = leafs[0];
		}
	} else {
		node.left = null;
	}

	if (length - median === 1) {
		node.right = leafs[median];
	} else {
		node.right = L.Tree.buildTree(leafs.slice(median), dimension + 1);
	}

	node.updateInformations();

	return node;
};

L.Tree._compareMethods = [
	// Latitude
	function (a, b) {
		var apos = a._treePosition.lat,
			bpos = b._treePosition.lat;

		/*jshint bitwise: false*/
		return (apos > bpos ? 1 : (apos < bpos ? -1 : 0))|0;
	},
	// Longitude
	function (a, b) {
		var apos = a._treePosition.lng,
			bpos = b._treePosition.lng;

		/*jshint bitwise: false*/
		return (apos > bpos ? 1 : (apos < bpos ? -1 : 0))|0;
	}
];

L.Tree._applyInformations = function (obj, count, pos, bounds) {
	var tmpCount = obj.count;
	obj.count += count;

	if (obj.count > 0) {
		obj.posAverage.lat = (obj.posAverage.lat * tmpCount +
			pos.lat * count) / obj.count;
		obj.posAverage.lng = (obj.posAverage.lng * tmpCount +
			pos.lng * count) / obj.count;
	}

	if (!obj.bounds) {
		obj.bounds = new L.LatLngBounds();
	}

	obj.bounds.extend(bounds);
};

/* Copyright (c) 2012 the authors listed at the following URL, and/or
the authors of referenced articles or incorporated external code:
http://en.literateprograms.org/Quickhull_(Javascript)?action=history&offset=20120410175256

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Retrieved from: http://en.literateprograms.org/Quickhull_(Javascript)?oldid=18434
*/

(function () {
	L.QuickHull = {

		/*
		 * @param {Object} cpt a point to be measured from the baseline
		 * @param {Array} bl the baseline, as represented by a two-element
		 *   array of latlng objects.
		 * @returns {Number} an approximate distance measure
		 */
		getDistant: function (cpt, bl) {
			var vY = bl[1].lat - bl[0].lat,
				vX = bl[0].lng - bl[1].lng;
			return (vX * (cpt.lat - bl[0].lat) + vY * (cpt.lng - bl[0].lng));
		},

		/*
		 * @param {Array} baseLine a two-element array of latlng objects
		 *   representing the baseline to project from
		 * @param {Array} latLngs an array of latlng objects
		 * @returns {Object} the maximum point and all new points to stay
		 *   in consideration for the hull.
		 */
		findMostDistantPointFromBaseLine: function (baseLine, latLngs) {
			var maxD = 0,
				maxPt = null,
				newPoints = [],
				i, pt, d;

			for (i = latLngs.length - 1; i >= 0; i--) {
				pt = latLngs[i];
				d = this.getDistant(pt, baseLine);

				if (d > 0) {
					newPoints.push(pt);
				} else {
					continue;
				}

				if (d > maxD) {
					maxD = d;
					maxPt = pt;
				}
			}

			return { maxPoint: maxPt, newPoints: newPoints };
		},


		/*
		 * Given a baseline, compute the convex hull of latLngs as an array
		 * of latLngs.
		 *
		 * @param {Array} latLngs
		 * @returns {Array}
		 */
		buildConvexHull: function (baseLine, latLngs) {
			var convexHullBaseLines = [],
				t = this.findMostDistantPointFromBaseLine(baseLine, latLngs);

			if (t.maxPoint) { // if there is still a point "outside" the base line
				convexHullBaseLines =
					convexHullBaseLines.concat(
						this.buildConvexHull([baseLine[0], t.maxPoint], t.newPoints)
					);
				convexHullBaseLines =
					convexHullBaseLines.concat(
						this.buildConvexHull([t.maxPoint, baseLine[1]], t.newPoints)
					);
				return convexHullBaseLines;
			} else {  // if there is no more point "outside" the base line, the current base line is part of the convex hull
				return [baseLine[0]];
			}
		},

		/*
		 * Given an array of latlngs, compute a convex hull as an array
		 * of latlngs
		 *
		 * @param {Array} latLngs
		 * @returns {Array}
		 */
		getConvexHull: function (latLngs) {
			// find first baseline
			var maxLat = false, minLat = false,
				maxPt = null, minPt = null,
				i;

			for (i = latLngs.length - 1; i >= 0; i--) {
				var pt = latLngs[i];
				if (maxLat === false || pt.lat > maxLat) {
					maxPt = pt;
					maxLat = pt.lat;
				}
				if (minLat === false || pt.lat < minLat) {
					minPt = pt;
					minLat = pt.lat;
				}
			}
			var ch = [].concat(this.buildConvexHull([minPt, maxPt], latLngs),
								this.buildConvexHull([maxPt, minPt], latLngs));
			return ch;
		}
	};
}());

L.MarkerCluster.include({
	getConvexHull: function () {
		var childMarkers = this.getAllChildMarkers(),
			points = [],
			p, i;

		for (i = childMarkers.length - 1; i >= 0; i--) {
			p = childMarkers[i].getLatLng();
			points.push(p);
		}

		return L.QuickHull.getConvexHull(points);
	}
});


//This code is 100% based on https://github.com/jawj/OverlappingMarkerSpiderfier-Leaflet
//Huge thanks to jawj for implementing it first to make my job easy :-)

L.MarkerCluster.include({

	_2PI: Math.PI * 2,
	_circleFootSeparation: 25, //related to circumference of circle
	_circleStartAngle: Math.PI / 6,

	_spiralFootSeparation:  28, //related to size of spiral (experiment!)
	_spiralLengthStart: 11,
	_spiralLengthFactor: 5,

	_circleSpiralSwitchover: 9, //show spiral instead of circle from this marker count upwards.
								// 0 -> always spiral; Infinity -> always circle

	spiderfy: function () {
		if (this._group._spiderfied === this || this._group._inZoomAnimation) {
			return;
		}

		var childMarkers = this.getAllChildMarkers(),
			group = this._group,
			map = group._map,
			center = map.latLngToLayerPoint(this._latlng),
			positions;

		this._group._unspiderfy();
		this._group._spiderfied = this;

		//TODO Maybe: childMarkers order by distance to center

		if (childMarkers.length >= this._circleSpiralSwitchover) {
			positions = this._generatePointsSpiral(childMarkers.length, center);
		} else {
			center.y += 10; //Otherwise circles look wrong
			positions = this._generatePointsCircle(childMarkers.length, center);
		}

		this._animationSpiderfy(childMarkers, positions);
	},

	unspiderfy: function (zoomDetails) {
		/// <param Name="zoomDetails">Argument from zoomanim if being called in a zoom animation or null otherwise</param>
		if (this._group._inZoomAnimation) {
			return;
		}
		this._animationUnspiderfy(zoomDetails);

		this._group._spiderfied = null;
	},

	_generatePointsCircle: function (count, centerPt) {
		var circumference = this._group.options.spiderfyDistanceMultiplier * this._circleFootSeparation * (2 + count),
			legLength = circumference / this._2PI,  //radius from circumference
			angleStep = this._2PI / count,
			res = [],
			i, angle;

		res.length = count;

		for (i = count - 1; i >= 0; i--) {
			angle = this._circleStartAngle + i * angleStep;
			res[i] = new L.Point(centerPt.x + legLength * Math.cos(angle), centerPt.y + legLength * Math.sin(angle))._round();
		}

		return res;
	},

	_generatePointsSpiral: function (count, centerPt) {
		var legLength = this._group.options.spiderfyDistanceMultiplier * this._spiralLengthStart,
			separation = this._group.options.spiderfyDistanceMultiplier * this._spiralFootSeparation,
			lengthFactor = this._group.options.spiderfyDistanceMultiplier * this._spiralLengthFactor,
			angle = 0,
			res = [],
			i;

		res.length = count;

		for (i = count - 1; i >= 0; i--) {
			angle += separation / legLength + i * 0.0005;
			res[i] = new L.Point(centerPt.x + legLength * Math.cos(angle), centerPt.y + legLength * Math.sin(angle))._round();
			legLength += this._2PI * lengthFactor / angle;
		}
		return res;
	},

	_noanimationUnspiderfy: function () {
		var group = this._group,
			map = group._map,
			fg = group._featureGroup,
			childMarkers = this.getAllChildMarkers(),
			m, i;

		this.setOpacity(1);
		for (i = childMarkers.length - 1; i >= 0; i--) {
			m = childMarkers[i];

			fg.removeLayer(m);

			if (m._preSpiderfyLatlng) {
				m.setLatLng(m._preSpiderfyLatlng);
				delete m._preSpiderfyLatlng;
			}
			if (m.setZIndexOffset) {
				m.setZIndexOffset(0);
			}

			if (m._spiderLeg) {
				map.removeLayer(m._spiderLeg);
				delete m._spiderLeg;
			}
		}

		group._spiderfied = null;
	}
});

L.MarkerCluster.include(!L.DomUtil.TRANSITION ? {
	//Non Animated versions of everything
	_animationSpiderfy: function (childMarkers, positions) {
		var group = this._group,
			map = group._map,
			fg = group._featureGroup,
			i, m, leg, newPos;

		for (i = childMarkers.length - 1; i >= 0; i--) {
			newPos = map.layerPointToLatLng(positions[i]);
			m = childMarkers[i];

			m._preSpiderfyLatlng = m._latlng;
			m.setLatLng(newPos);
			if (m.setZIndexOffset) {
				m.setZIndexOffset(1000000); //Make these appear on top of EVERYTHING
			}

			fg.addLayer(m);


			leg = new L.Polyline([this._latlng, newPos], { weight: 1.5, color: '#222' });
			map.addLayer(leg);
			m._spiderLeg = leg;
		}
		this.setOpacity(0.3);
		group.fire('spiderfied');
	},

	_animationUnspiderfy: function () {
		this._noanimationUnspiderfy();
	}
} : {
	//Animated versions here
	SVG_ANIMATION: (function () {
		return document.createElementNS('http://www.w3.org/2000/svg', 'animate').toString().indexOf('SVGAnimate') > -1;
	}()),

	_animationSpiderfy: function (childMarkers, positions) {
		var me = this,
			group = this._group,
			map = group._map,
			fg = group._featureGroup,
			thisLayerPos = map.latLngToLayerPoint(this._latlng),
			i, m, leg, newPos;

		//Add markers to map hidden at our center point
		for (i = childMarkers.length - 1; i >= 0; i--) {
			m = childMarkers[i];

			//If it is a marker, add it now and we'll animate it out
			if (m.setOpacity) {
				m.setZIndexOffset(1000000); //Make these appear on top of EVERYTHING
				m.setOpacity(0);
			
				fg.addLayer(m);

				m._setPos(thisLayerPos);
			} else {
				//Vectors just get immediately added
				fg.addLayer(m);
			}
		}

		group._forceLayout();
		group._animationStart();

		var initialLegOpacity = L.Path.SVG ? 0 : 0.3,
			xmlns = L.Path.SVG_NS;


		for (i = childMarkers.length - 1; i >= 0; i--) {
			newPos = map.layerPointToLatLng(positions[i]);
			m = childMarkers[i];

			//Move marker to new position
			m._preSpiderfyLatlng = m._latlng;
			m.setLatLng(newPos);
			
			if (m.setOpacity) {
				m.setOpacity(1);
			}


			//Add Legs.
			leg = new L.Polyline([me._latlng, newPos], { weight: 1.5, color: '#222', opacity: initialLegOpacity });
			map.addLayer(leg);
			m._spiderLeg = leg;

			//Following animations don't work for canvas
			if (!L.Path.SVG || !this.SVG_ANIMATION) {
				continue;
			}

			//How this works:
			//http://stackoverflow.com/questions/5924238/how-do-you-animate-an-svg-path-in-ios
			//http://dev.opera.com/articles/view/advanced-svg-animation-techniques/

			//Animate length
			var length = leg._path.getTotalLength();
			leg._path.setAttribute("stroke-dasharray", length + "," + length);

			var anim = document.createElementNS(xmlns, "animate");
			anim.setAttribute("attributeName", "stroke-dashoffset");
			anim.setAttribute("begin", "indefinite");
			anim.setAttribute("from", length);
			anim.setAttribute("to", 0);
			anim.setAttribute("dur", 0.25);
			leg._path.appendChild(anim);
			anim.beginElement();

			//Animate opacity
			anim = document.createElementNS(xmlns, "animate");
			anim.setAttribute("attributeName", "stroke-opacity");
			anim.setAttribute("attributeName", "stroke-opacity");
			anim.setAttribute("begin", "indefinite");
			anim.setAttribute("from", 0);
			anim.setAttribute("to", 0.5);
			anim.setAttribute("dur", 0.25);
			leg._path.appendChild(anim);
			anim.beginElement();
		}
		me.setOpacity(0.3);

		//Set the opacity of the spiderLegs back to their correct value
		// The animations above override this until they complete.
		// If the initial opacity of the spiderlegs isn't 0 then they appear before the animation starts.
		if (L.Path.SVG) {
			this._group._forceLayout();

			for (i = childMarkers.length - 1; i >= 0; i--) {
				m = childMarkers[i]._spiderLeg;

				m.options.opacity = 0.5;
				m._path.setAttribute('stroke-opacity', 0.5);
			}
		}

		setTimeout(function () {
			group._animationEnd();
			group.fire('spiderfied');
		}, 200);
	},

	_animationUnspiderfy: function (zoomDetails) {
		var group = this._group,
			map = group._map,
			fg = group._featureGroup,
			thisLayerPos = zoomDetails ? map._latLngToNewLayerPoint(this._latlng, zoomDetails.zoom, zoomDetails.center) : map.latLngToLayerPoint(this._latlng),
			childMarkers = this.getAllChildMarkers(),
			svg = L.Path.SVG && this.SVG_ANIMATION,
			m, i, a;

		group._animationStart();

		//Make us visible and bring the child markers back in
		this.setOpacity(1);
		for (i = childMarkers.length - 1; i >= 0; i--) {
			m = childMarkers[i];

			//Marker was added to us after we were spidified
			if (!m._preSpiderfyLatlng) {
				continue;
			}

			//Fix up the location to the real one
			m.setLatLng(m._preSpiderfyLatlng);
			delete m._preSpiderfyLatlng;
			//Hack override the location to be our center
			if (m.setOpacity) {
				m._setPos(thisLayerPos);
				m.setOpacity(0);
			} else {
				fg.removeLayer(m);
			}

			//Animate the spider legs back in
			if (svg) {
				a = m._spiderLeg._path.childNodes[0];
				a.setAttribute('to', a.getAttribute('from'));
				a.setAttribute('from', 0);
				a.beginElement();

				a = m._spiderLeg._path.childNodes[1];
				a.setAttribute('from', 0.5);
				a.setAttribute('to', 0);
				a.setAttribute('stroke-opacity', 0);
				a.beginElement();

				m._spiderLeg._path.setAttribute('stroke-opacity', 0);
			}
		}

		setTimeout(function () {
			//If we have only <= one child left then that marker will be shown on the map so don't remove it!
			var stillThereChildCount = 0;
			for (i = childMarkers.length - 1; i >= 0; i--) {
				m = childMarkers[i];
				if (m._spiderLeg) {
					stillThereChildCount++;
				}
			}


			for (i = childMarkers.length - 1; i >= 0; i--) {
				m = childMarkers[i];

				if (!m._spiderLeg) { //Has already been unspiderfied
					continue;
				}


				if (m.setOpacity) {
					m.setOpacity(1);
					m.setZIndexOffset(0);
				}

				if (stillThereChildCount > 1) {
					fg.removeLayer(m);
				}

				map.removeLayer(m._spiderLeg);
				delete m._spiderLeg;
			}
			group._animationEnd();
		}, 200);
	}
});


L.MarkerClusterGroup.include({
	//The MarkerCluster currently spiderfied (if any)
	_spiderfied: null,

	_spiderfierOnAdd: function () {
		this._map.on('click', this._unspiderfyWrapper, this);

		if (this._map.options.zoomAnimation) {
			this._map.on('zoomstart', this._unspiderfyZoomStart, this);
		}
		//Browsers without zoomAnimation or a big zoom don't fire zoomstart
		this._map.on('zoomend', this._noanimationUnspiderfy, this);

		if (L.Path.SVG && !L.Browser.touch) {
			this._map._initPathRoot();
			//Needs to happen in the pageload, not after, or animations don't work in webkit
			//  http://stackoverflow.com/questions/8455200/svg-animate-with-dynamically-added-elements
			//Disable on touch browsers as the animation messes up on a touch zoom and isn't very noticable
		}
	},

	_spiderfierOnRemove: function () {
		this._map.off('click', this._unspiderfyWrapper, this);
		this._map.off('zoomstart', this._unspiderfyZoomStart, this);
		this._map.off('zoomanim', this._unspiderfyZoomAnim, this);

		this._unspiderfy(); //Ensure that markers are back where they should be
	},


	//On zoom start we add a zoomanim handler so that we are guaranteed to be last (after markers are animated)
	//This means we can define the animation they do rather than Markers doing an animation to their actual location
	_unspiderfyZoomStart: function () {
		if (!this._map) { //May have been removed from the map by a zoomEnd handler
			return;
		}

		this._map.on('zoomanim', this._unspiderfyZoomAnim, this);
	},
	_unspiderfyZoomAnim: function (zoomDetails) {
		//Wait until the first zoomanim after the user has finished touch-zooming before running the animation
		if (L.DomUtil.hasClass(this._map._mapPane, 'leaflet-touching')) {
			return;
		}

		this._map.off('zoomanim', this._unspiderfyZoomAnim, this);
		this._unspiderfy(zoomDetails);
	},


	_unspiderfyWrapper: function () {
		/// <summary>_unspiderfy but passes no arguments</summary>
		this._unspiderfy();
	},

	_unspiderfy: function (zoomDetails) {
		if (this._spiderfied) {
			this._spiderfied.unspiderfy(zoomDetails);
		}
	},

	_noanimationUnspiderfy: function () {
		if (this._spiderfied) {
			this._spiderfied._noanimationUnspiderfy();
		}
	},

	//If the given layer is currently being spiderfied then we unspiderfy it so it isn't on the map anymore etc
	_unspiderfyLayer: function (layer) {
		if (layer._spiderLeg) {
			this._featureGroup.removeLayer(layer);

			layer.setOpacity(1);
			//Position will be fixed up immediately in _animationUnspiderfy
			layer.setZIndexOffset(0);

			this._map.removeLayer(layer._spiderLeg);
			delete layer._spiderLeg;
		}
	}
});


}(window, document));