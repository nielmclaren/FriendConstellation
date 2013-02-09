
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
	
	var layoutSize = 8196;
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


CustomNodeRenderer = function(constellation, nodeId, data) {
	NodeRenderer.call(this, constellation, nodeId, data);
	this.state = 'default';
};

CustomNodeRenderer.prototype = new NodeRenderer();
CustomNodeRenderer.prototype.constructor = CustomNodeRenderer;

CustomNodeRenderer.prototype.defaultStyles = {};

CustomNodeRenderer.prototype.setState = function(state) {
	this.state = state;
};

CustomNodeRenderer.prototype.create = function(){
	var svg = this.constellation.svg;
	var container = this.constellation.getNodeContainer();
	
	var group = svg.group(container, {'display': 'none'});
	this.renderer = {
		group: group,
		graphic: svg.circle(group, 0, 0, 5, {
			'fill': '#9999ff',
			'stroke': '#666666',
			'strokeWidth': 1
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

	var selected = this.state == 'selected';
	var hasSelection = this.constellation.getSelectedNodeId() != null;
	var settings = {};
	switch (this.state) {
		case 'selected':
			settings = {
				'fill': '#ff3333',
				'stroke': '#666666',
				'strokeWidth': 2
			};
			break;
		case 'emphasized':
			settings = {
				'fill': '#ff9999',
				'stroke': '#666666',
				'strokeWidth': 1
			};
			break;
		default:
			settings = {
				'fill': hasSelection ? '#eeeeee' : '#9999ff',
				'stroke': '#666666',
				'strokeWidth': hasSelection ? 0 : 1
			};
			break;
	}
	svg.change(this.renderer.graphic, settings);
	
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


CustomEdgeRenderer = function(constellation, edgeId, tailNodeRenderer, headNodeRenderer, data) {
	EdgeRenderer.call(this, constellation, edgeId, tailNodeRenderer, headNodeRenderer, data);
};

CustomEdgeRenderer.prototype = new EdgeRenderer();
CustomEdgeRenderer.prototype.constructor = CustomEdgeRenderer;

CustomEdgeRenderer.prototype['defaultStyles'] = {};

CustomEdgeRenderer.prototype.setState = function(state) {
	this.state = state;
};

CustomEdgeRenderer.prototype.create = function() {
	var svg = this['constellation']['svg'];
	var container = this['constellation'].getEdgeContainer();
	var group = svg.group(container);
	this.renderer = {
		group: group,
		line: svg.line(group, 0, 0, 10, 0, {
			'display': 'none',
			'stroke': '#cccccc',
			'strokeWidth': 2
		})
	};
	
	jQuery(this.renderer.line)
		.bind('mouseover', {'context':this}, function(event) {
			event.data.context['constellation']['edgemouseoverHandler'](event, event.data.context);
		})
		.bind('mouseout', {'context':this}, function(event) {
			event.data.context['constellation']['edgemouseoutHandler'](event, event.data.context);
		})
		.bind('mousedown', {'context':this}, function(event) {
			event.data.context['constellation']['edgemousedownHandler'](event, event.data.context);
		})
		.bind('mouseup', {'context':this}, function(event) {
			event.data.context['constellation']['edgemouseupHandler'](event, event.data.context);
		})
		.bind('click', {'context':this}, function(event) {
			event.data.context['constellation']['edgeclickHandler'](event, event.data.context);
		})
		.bind('touchstart', {'context':this}, function(event) {
			event.data.context['constellation']['edgetouchstartHandler'](event, event.data.context);
		})
		.bind('touchend', {'context':this}, function(event) {
			event.data.context['constellation']['edgetouchendHandler'](event, event.data.context);
		});
};

CustomEdgeRenderer.prototype.draw = function() {
	var hasSelection = this.constellation.getSelectedNodeId() != null;
	jQuery(this.renderer.line)
		.css('stroke', this.state == 'emphasized' ? '#888888' : hasSelection ? '#eeeeee' : '#cccccc')
		.css('display', 'inline');
};

CustomEdgeRenderer.prototype.position = function() {
	jQuery(this.renderer.line)
		.attr('x1', this['tailNode']['x'])
		.attr('y1', this['tailNode']['y'])
		.attr('x2', this['headNode']['x'])
		.attr('y2', this['headNode']['y'])
		.css('display', 'inline');
};

CustomEdgeRenderer.prototype.destroy = function() {
	jQuery(this.renderer.line).remove();
};
