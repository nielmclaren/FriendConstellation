
var constellation;
var prevSelectedNodeId;
var popoverTimeoutId;

var categoryColors = ['#ba2022', '#4c14b3', '#1a51c5', '#3b70b6', '#009b3a', '#f8a20d'];

var extendedPermissions = [
	'friends_relationships',
	'friends_hometown',
	'friends_location',
	'friends_religion_politics',
	'friends_relationship_details'
];
var basicFields = ['id', 'name', 'username', 'gender', 'link'];
var extendedFields = ['hometown', 'location', 'political', 'relationship_status', 'religion'];

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
				}, 350);
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

	$('#additionalPermissionsButton').click(function(event) {
		FB.login(function(response) {
			// User might have clicked cancel so have to check permissions again.
			FB.api('/me/permissions', function(response) {
				if (response.data) {
					var ungrantedPermissions = extendedPermissions.filter(function(d,i,a) { return response.data[0][d] != 1; });
					if (ungrantedPermissions.length > 0) {
						console.log("Missing permissions: " + ungrantedPermissions.join(', '));
						$('#additionalPermissionsButton').show();
					}
					else {
						loadFriends(basicFields.concat(extendedFields));
						$('#additionalPermissionsButton').hide();
					}
				}
			});
		}, {scope: extendedPermissions.join(',')});
	});

	FB.getLoginStatus(function(response) {
		if (response.status === 'connected') {
			// If we're logged in, check whether the user has granted the extended permissions.
			FB.api('/me/permissions', function(response) {
				if (response.data) {
					var ungrantedPermissions = extendedPermissions.filter(function(d,i,a) { return response.data[0][d] != 1; });
					if (ungrantedPermissions.length > 0) {
						console.log("Missing permissions: " + ungrantedPermissions.join(', '));
						loadFriends(basicFields);
						$('#additionalPermissionsButton').show();
					}
					else {
						loadFriends(basicFields.concat(extendedFields));
						$('#additionalPermissionsButton').hide();
					}
				}
				else {
					// FIXME: Implement error handling.
					console.log(response);
				}
			});
		}
		else {
			// Not logged in so send the user back.
			window.location = '/';
		}
	});
}

function loadFriends(fields) {
	FB.api('/me/friends?fields=' + fields.join(','), function(response) {
		if (response.data) {
			// Update the friend info in the graph data model.
			var model = constellation.getModel();
			$.each(response.data, function(i, friend) {
				var node = model.getNode(friend.id);
				if (node) {
					$.extend(node.data, friend);
				}
				else {
					console.warn("Friend loaded from Facebook wasn't found in the graph data.");
				}
			});
			constellation.modelChanged();

			// Add the friends to the "Jump to" dropdown.
			$('#friendList').empty();
			response.data.sort(function(a,b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
			$.each(response.data, function(i, d) {
				$('#friendList').append(
					"<li><a href=\"javascript:selectNode('" + d.id + "');\">" + d.name + '</a></li>');
			});

			// Get information for filtering.
			var filterData = getFilterData(response.data);
			$.each(filterData, function(field, fieldData) {
				var filterList = $('#' + field + 'FilterList');
				filterList.empty().append('<li><a href="#">All</a></li><li class="divider"></li>');

				var undisclosed, other, hasValue = false;
				$.each(fieldData, function(i, data) {
					var value = data.value;
					var count = data.count;

					if (value == 'Undisclosed') {
						undisclosed = data;
					}
					else if (value == 'Other') {
						other = data;
					}
					else {
						if (value == 'male') value = 'Male';
						if (value == 'female') value = 'Female';
						filterList.append(formatFilterListItem(field, value, count));
						hasValue = true;
					}
				});

				if (hasValue && (undisclosed || other)) {
					filterList.append('<span class="divider"></span>');
				}
				if (undisclosed) {
					filterList.append(formatFilterListItem(field, undisclosed.value, undisclosed.count));
				}
				if (other) {
					filterList.append(formatFilterListItem(field, other.value, other.count));
				}
			});
		}
		else {
			// FIXME: Implement error-handling.
			console.warn("Error loading friends from Facebook.");
			console.log(response);
		}
	});
}

function getFilterData(friends) {
	var filterFields = ['gender', 'relationship_status', 'location', 'hometown', 'political', 'religion'];
	var filterData = {};
	$.each(friends, function(i, friend) {
		$.each(filterFields, function(j, field) {
			if (!filterData[field]) filterData[field] = {};

			var value;
			switch (field) {
				case 'hometown':
				case 'location':
					value = friend[field] ? friend[field]['name'] : null;
					break;
				default:
					value = friend[field];
			}

			if (value == null) {
				if (filterData[field]['Undisclosed']) {
					filterData[field]['Undisclosed']++;
				}
				else {
					filterData[field]['Undisclosed'] = 1;
				}
			}
			else if (filterData[field][value]) {
				filterData[field][value]++;
			}
			else {
				filterData[field][value] = 1;
			}
		});
	});

	// Aggregate infrequent values.
	$.each(filterData, function(field, fieldData) {
		var otherCount = 0;
		$.each(fieldData, function(value, count) {
			if (count < 3) {
				otherCount += count;
				delete fieldData[value];
			}
		});
		if (otherCount > 0) {
			fieldData['Other'] = otherCount;
		}
	});

	// Convert field values to an array and sort.
	$.each(filterData, function(field, fieldData) {
		var fieldArray = [];
		$.each(fieldData, function(value, count) {
			fieldArray.push({value: value, count: count});
		});
		fieldArray.sort(function(a,b) {
			if (a.count < b.count) return 1;
			if (a.count > b.count) return -1;
			return 0;
		});
		filterData[field] = fieldArray;
	});

	return filterData;
}

function formatFilterListItem(field, value, count) {
	if (value.length > 30) {
		value = value.substr(0, 27) + '...';
	}

	return '<li><a href="#">' + value
		+ ' <span class="muted">(' + count + ' ' + (count == 1 ? 'friend' : 'friends') + ')'
		+ '</span></a></li>';
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

