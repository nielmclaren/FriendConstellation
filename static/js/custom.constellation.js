
/**
 * 
 * @param config
 * @returns {CustomGraphParser}
 * @constructor
 */
CustomGraphParser = function(config) {
	// Constructor with no arguments is used for subclasses.
	if (arguments.length <= 0) return;
	
	GraphParser.call(this, config);
};

CustomGraphParser.prototype = new GraphParser();
CustomGraphParser.prototype.constructor = CustomGraphParser;

CustomGraphParser.prototype.parse = function(data) {
	if (!(data instanceof jQuery)) {
		data = jQuery.parseJSON(data);
	}

	var graph = this.graph;
	
	var layoutSize = 4096;
	jQuery.each(data.nodes, function(i, node) {
		// Incoming values are normalized [0-1].
		node.x = node.x * layoutSize - layoutSize/2;
		node.y = node.y * layoutSize - layoutSize/2;
		graph.addNode(node.id, node);
	});

	jQuery.each(data.edges, function(i, edge) {
		graph.addEdge(edge[0] + '-' + edge[1], edge[0], edge[1]);
	});

	jQuery(this).trigger('complete');
};


CustomLayout = function(config) {
	if (arguments.length <= 0) return;
	Layout.call(this, config);
};

CustomLayout.prototype = new Layout();
CustomLayout.prototype.constructor = CustomLayout;

CustomLayout.prototype.viewChanged = function(){
	var nodes = this['constellation'].getNodes();
	for (var i = 0; i < nodes.length; i++) {
		var node = nodes[i];
		if (node['x'] == null || node['y'] == null) {
			if (node['data']['x']) {
				node['x'] = node['data']['x'];
			}
			else {
				node['x'] = (Math.random() - 0.5) * this['constellation'].viewportWidth;
			}
			
			if (node['data']['y']) {
				node['y'] = node['data']['y'];
			}
			else {
				node['y'] = (Math.random() - 0.5) * this['constellation'].viewportHeight;
			}
		}
	}
	
	jQuery(this).trigger('change');
};


/**
 * 
 * @param constellation
 * @param nodeId
 * @param data
 * @returns {CustomNodeRenderer}
 * @constructor
 */
CustomNodeRenderer = function(constellation, nodeId, data) {
	NodeRenderer.call(this, constellation, nodeId, data);
};

CustomNodeRenderer.prototype = new NodeRenderer();
CustomNodeRenderer.prototype.constructor = CustomNodeRenderer;

CustomNodeRenderer.prototype.defaultStyles = {};

CustomNodeRenderer.prototype.create = function(){
	var svg = this.constellation.svg;
	var container = this.constellation.getNodeContainer();
	
	var group = svg.group(container, {'display': 'none'});
	this.renderer = {
		group: group,
		graphic: svg.circle(group, 0, 0, 5, {
			'fill': this.data.selected ? '#ff9999' : '#9999ff',
			'stroke': '#666666',
			'strokeWidth': 1
/*
		}),
		labelBackground: svg.rect(group, 0, 0, 0, 0, 2, 2, {
			'fill': '#f6f6f6',
			'stroke': '#333333',
			'strokeWidth': 1
		}),
		label: svg.text(group, 0, 0, this.data.name, {
			'style': '-webkit-user-select: none;-khtml-user-select: none;-moz-user-select: none;-o-user-select: none;user-select: none;',
			'fontFamily': 'Verdana',
			'fontSize': 10,
			'fontWeight': 'normal',
			'fill': '#441111',
			'textAnchor': 'middle',
			
			// HACK: Better cross-browser compatibility with 'dy'
			//dominantBaseline: 'central'
			'dy': '.35em'
*/
		})
	};
	
	jQuery(this.renderer.group)
		.bind('mouseover', {'context':this}, function(event) {
			event.data.context.constellation.nodemouseoverHandler(event, event.data.context);
		})
		.bind('mouseout', {'context':this}, function(event) {
			event.data.context.constellation.nodemouseoutHandler(event, event.data.context);
		})
		.bind('mousedown', {'context':this}, function(event) {
			event.data.context.constellation.nodemousedownHandler(event, event.data.context);
		})
		.bind('mouseup', {'context':this}, function(event) {
			event.data.context.constellation.nodemouseupHandler(event, event.data.context);
		})
		.bind('click', {'context':this}, function(event) {
			event.data.context.constellation.nodeclickHandler(event, event.data.context);
		});
};

CustomNodeRenderer.prototype.draw = function() {
	var svg = this['constellation']['svg'];
/*
	var labelBounds = this.renderer.label.getBBox();
	var horizontalPadding = 8, verticalPadding = 3;
	
	var labelBackground = jQuery(this.renderer.labelBackground);
	if (labelBounds.width > 0 && labelBounds.height > 0) {
		labelBackground.css('display', 'inline');
		labelBackground.attr('x', labelBounds.x - horizontalPadding);
		labelBackground.attr('y', labelBounds.y - verticalPadding);
		labelBackground.attr('width', labelBounds.width + 2*horizontalPadding);
		labelBackground.attr('height', labelBounds.height + 2*verticalPadding);
	}
	else {
		labelBackground.css('display', 'none');
	}
*/
	svg.change(this.renderer.graphic, {'fill': this.data.selected ? '#ff9999' : '#9999ff'});
	
	this.position();
	
	jQuery(this.renderer.group).css('display', 'inline');
};

CustomNodeRenderer.prototype.position = function() {
	jQuery(this.renderer.group)
		.attr('transform', 'translate(' + this.x + ',' + this.y + ')');
};

CustomNodeRenderer.prototype.destroy = function() {
	jQuery(this.renderer.group).remove();
	this.renderer = null;
};


