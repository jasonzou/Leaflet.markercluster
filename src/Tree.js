
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