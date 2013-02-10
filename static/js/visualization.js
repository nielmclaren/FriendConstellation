
var constellation;
var prevSelectedNodeId;
var popoverTimeoutId;

function initConstellation() {
	var config = {
		id: 'constellation',
		graphLoaderClass: SimpleGraphLoader,
		graphLoader: {
			url: '/chart/' + chartId + '/data'
		},
		graphParserClass: CustomGraphParser,
		graphViewClass: DirectGraphView,
		layoutClass: CustomLayout,
		layout: {}
	};
	var styles = [
		['node', {rendererClass: CustomNodeRenderer}],
		['edge', {rendererClass: CustomEdgeRenderer}]
	];

	constellation = new Constellation(config, styles);
	$(constellation)
		.bind('log', function(event, severity, message) {
			if (window['console']) {
				var args = Array.prototype.slice.call(arguments, 2);
				switch (severity) {
					case 'debug':
						//window.console.debug.apply(window.console, args);
						break;
					case 'warn':
						window.console.warn.apply(window.console, args);
						break;
					case 'error':
						window.console.error.apply(window.console, args);
						break;
				}
			}
		})
		.bind('nodemouseover', function(event, nodeId) {
			var node = constellation.getNode(nodeId);
			if (node) {
				if (popoverTimeoutId) clearTimeout(popoverTimeoutId);
				popoverTimeoutId = setTimeout(function() {
					showNodePopover(node);
					positionNodePopover(node);
				}, 250);
			}
		})
		.bind('nodemouseout', function(event, nodeId) {
			if (popoverTimeoutId) clearTimeout(popoverTimeoutId);
			$('#nodePopover').hide();
		})
		.bind('nodeclick', function(event, nodeId) {
			var node = constellation.getNode(nodeId);

			if (constellation.getSelectedNodeId() == nodeId) {
				if ($('#nodePopover').css('display') == 'block') {
					$('#nodePopover').hide();
				}
				else {
					$('#nodePopover').show();
				}
			}
			else {
				selectNode(nodeId);
			}
		})
		.bind('click', function(event) {
			// Background click.
			selectNode(null);
		})
		.bind('viewchanged', function(event) {
			var fragment = String(location.hash);
			if (fragment && fragment.length > 0) {
				if (fragment.charAt(0) == '#') {
					fragment = fragment.substring(1);
				}
				// If there's a URL fragment, jump to that node.
				selectNode(fragment);
			}
		});


	constellation.init();


	// If the URL fragment changes, jump to that node.
	$(window).bind('hashchange', function(event) {
		var fragment = String(location.hash);
		if (fragment && fragment.length > 0) {
			if (fragment.charAt(0) == '#') {
				fragment = fragment.substring(1);
			}
			selectNode(fragment);
		}
	});

	$('#zoomOutButton').click(function(event) {
		constellation.setZoomScale(Math.max(0.05, constellation.getZoomScale() * 0.7));
	});
	$('#zoomInButton').click(function(event) {
		constellation.setZoomScale(Math.min(2, constellation.getZoomScale() * 1.4));
	});

	FB.getLoginStatus(function(response) {
		if (response.status === 'connected') {
			FB.api('/me/friends', function(response) {
				if (response.data) {
					response.data.sort(function(a,b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
					$.each(response.data, function(i, d) {
						$('#friendList').append(
							"<li><a href=\"javascript:selectNode('" + d.id + "');\">" + d.name + '</a></li>');
					});
				}
			});
		}
		else {
			window.location = '/';
		}
	});
}

function selectNode(nodeId) {
	if (constellation.getSelectedNodeId() == nodeId) return;

	prevSelectedNodeId = constellation.getSelectedNodeId();
	constellation.setSelectedNodeId(nodeId);

	window.location.hash = nodeId == null ? '' : nodeId;

	var prevNode = constellation.getNode(prevSelectedNodeId);
	if (prevNode) {
		prevNode.setState('default');
		$.each(prevNode.edges, function(i, e) {
			e.setState('default');
			e.getOtherNode(prevSelectedNodeId).setState('default');
		});
	}

	var node = constellation.getNode(nodeId);
	if (node) {
		node.setState('selected');
		$.each(node.edges, function(i, e) {
			e.setState('emphasized');
			constellation.arrangeEdgeFront(e);

			var other = e.getOtherNode(nodeId);
			other.setState('emphasized');
			constellation.arrangeNodeFront(other);
		});
	}

	$.each(constellation.getNodes(), function(i, n) { n.draw(); });
	$.each(constellation.getEdges(), function(i, e) { e.draw(); });
}

function showNodePopover(node) {
	$('#nodePopover .popover-content').html(
		'<div style="float:left;height:50px;width:50px"><img src="' + node.data.pic_square + '" width="50" height="50" /></div>'
		+ '<div style="margin-left: 60px;min-height: 50px;"><p style="font-weight:bold">'
		+ '<a href="' + node.data.link + '" target="_blank" style="color:#333">' + node.data.name + '</a>'
		+ '</p></div>');
	$('#nodePopover').show();
}

function positionNodePopover(node) {
	var offset = $(node.renderer.group).offset();
	offset.top -= $('#nodePopover').height() + 17;
	offset.left -= $('#nodePopover').width() / 2 - 3;
	$('#nodePopover').offset(offset);
}

