
var constellation;
var prevSelectedNodeId;
var popoverTimeoutId;

var selectedFilterCategory;
var selectedFilterValue;
var categoryColors = ['#ba2022', '#4c14b3', '#3b70b6', '#009b3a', '#f8a20d'];

/**
 * A map of field names to objects containing two properties: map and list.
 *
 * The map property maps category field values to valueData objects. Field values
 * that were aggregated into the 'Other' category are mapped to the 'Other'
 * valueData object instead of their own valueData objects.
 *
 * The list property contains valueData objects sorted by reverse count with
 * 'Other' and 'Undisclosed' at the end. The list property does not contain
 * references to any values the were aggregated into the 'Other' category.
 *
 * valueData objects have the following properties:
 * - value: The field value, e.g., 'female'.
 * - count: The number of occurences of this value.
 * - index: The index of the valueData object in the list property. Used for color.
 * - other: Boolean indicating whether this is an 'Other' category.
 *
 * This gets initialized in parseCategoryData.
 */
var categoryData = {};

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
			selectNode(nodeId);
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
		// Popup the login dialogue asking for extended permissions.
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
			// Add the friend data to the nodes in the graph data model.
			var model = constellation.getModel();
			$.each(response.data, function(i, friend) {
				var node = model.getNode(friend.id);
				if (node) {
					// Collapse 'location' and 'hometown' values now to save us lots of pain later.
					if (friend['location']) {
						if (friend['location']['name']) {
							friend['location'] = friend['location']['name'];
						}
						else {
							delete friend['location'];
						}
					}
					if (friend['hometown']) {
						if (friend['hometown']) {
							friend['hometown'] = friend['hometown']['name'];
						}
						else {
							delete friend['hometown'];
						}
					}

					// Use capitalized gender labels.
					if (friend['gender'] == 'male') friend['gender'] = 'Male';
					if (friend['gender'] == 'female') friend['gender'] = 'Female';

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

			parseCategoryData(response.data);

			// Update category filter controls.
			$.each(categoryData, function(field, fieldData) {
				var filterList = $('#' + field + 'FilterList');
				filterList.empty().append(
					"<li><a href=\"javascript:setFilterCategory('" + field + "', 'All');\">All</a></li>"
					+ '<li class="divider"></li>');

				var undisclosed, other, hasValue = false;
				$.each(fieldData.list, function(i, data) {
					if (data.value == 'Undisclosed') {
						undisclosed = data;
					}
					else if (data.value == 'Other') {
						other = data;
					}
					else {
						filterList.append(formatFilterListItem(field, data.value, data.count, data.index));
						hasValue = true;
						index++;
					}
				});

				// Add the 'Other' and 'Undisclosed' categories at the end of the list with a divider.
				if (other) {
					filterList.append(formatFilterListItem(field, 'Other', other.count, other.index));
				}
				if ((hasValue || other) && undisclosed) {
					filterList.append('<span class="divider"></span>');
				}
				if (undisclosed) {
					filterList.append(formatFilterListItem(field, 'Undisclosed', undisclosed.count, undisclosed.index));
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

function parseCategoryData(friends) {
	var filterFields = ['gender', 'relationship_status', 'location', 'hometown', 'political', 'religion'];

	categoryData = {};

	$.each(friends, function(i, friend) {
		$.each(filterFields, function(j, field) {
			// We're gonna store the category data as a mapping from field name
			// and as a sorted list. Both will point to objects containing the
			// field value, the count, and the index.
			if (!categoryData[field]) categoryData[field] = {map: {}, list: []};

			var value = friend[field];
			if (value == null) {
				if (categoryData[field].map['Undisclosed']) {
					categoryData[field].map['Undisclosed'].count++;
				}
				else {
					categoryData[field].map['Undisclosed'] = {value: 'Undisclosed', count: 1, index: -1, other: false};
				}
			}
			else if (categoryData[field].map[value]) {
				categoryData[field].map[value].count++;
			}
			else {
				categoryData[field].map[value] = {value: value, count: 1, other: false};
			}
		});
	});

	// Aggregate infrequent values into the 'Other' category.
	var minGroupSize = 3;
	$.each(categoryData, function(field, fieldData) {
		var fieldMap = fieldData.map;

		var other;
		$.each(fieldMap, function(value, valueData) {
			if (valueData.count < minGroupSize) {
				if (other) {
					other.count += valueData.count;
				}
				else {
					fieldMap['Other'] = other = {value: 'Other', count: valueData.count, other: true};
				}

				// Point this value to the other valueData object.
				fieldMap[value] = other;
			}
		});
	});

	// Convert field values to an array, sort, and save the index values.
	$.each(categoryData, function(field, fieldData) {
		var fieldMap = fieldData.map;

		var fieldArray = [];
		var undisclosed, other;
		$.each(fieldMap, function(value, valueData) {
			if (value == 'Undisclosed') undisclosed = valueData;
			else if (value == 'Other') other = valueData;
			else if (!valueData.other) fieldArray.push(valueData);
		});

		fieldArray.sort(function(a,b) {
			if (a.count < b.count) return 1;
			if (a.count > b.count) return -1;
			if (a.value < b.value) return -1;
			if (a.value > b.value) return 1;
			return 0;
		});

		// Push 'Other' category onto fieldArray now so it gets an index.
		if (other) fieldArray.push(other);

		// Assign category indices.
		$.each(fieldArray, function(i, d) {
			d.index = i;
		});

		// Push 'Undisclosed' category onto fieldArray now so it keeps its index of -1.
		if (undisclosed) fieldArray.push(undisclosed);

		categoryData[field].list = fieldArray;
	});
}

function formatFilterListItem(field, value, count, index) {
	if (value.length > 30) {
		value = value.substr(0, 27) + '...';
	}

	var color = isNaN(index) || index < 0 || index >= categoryColors.length ? '#666666' : categoryColors[index];

	return '<li>'
		+ "<a href=\"javascript:setFilterCategory('" + field + "', '" + value + "');\">"
		+ '<i class="filterColor" style="background:' + color + '"></i>'
		+ value
		+ ' <span class="muted">(' + count + ' ' + (count == 1 ? 'friend' : 'friends') + ')'
		+ '</span></a></li>';
}

function setFilterCategory(field, filterValue) {
	// TODO: This should de-emphasize nodes when they're not in the filter category.
	selectedFilterCategory = field;
	selectedFilterValue = filterValue;

	$.each(constellation.getNodes(), function(i, node) {
		if (field) {
			var value = node.data[field];
			if (!value) value = 'Undisclosed';
			node.data.category = categoryData[field].map[value].index; 
		}
		else {
			node.data.category = -1;
		}
		node.draw();
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
	var categoryValueStr = '';
	if (selectedFilterCategory) {
		var value = node.data[selectedFilterCategory];
		if (!value) value = 'Undisclosed';
		categoryValueStr = '<p>' + value + '</p>';
	}

	$('#nodePopover .popover-content').html(
		'<div style="float:left;height:50px;width:50px"><img src="' + node.data.pic_square + '" width="50" height="50" /></div>'
		+ '<div style="margin-left: 60px;min-height: 50px;"><p style="font-weight:bold">'
		+ '<a href="' + node.data.link + '" target="_blank" style="color:#333">' + node.data.name + '</a>'
		+ '</p>'
		+ categoryValueStr
		+ '</div>');
	$('#nodePopover').show();
}

function positionNodePopover(node) {
	var offset = $(node.renderer.group).offset();
	offset.top -= $('#nodePopover').height() + 17;
	offset.left -= $('#nodePopover').width() / 2 - 3;
	$('#nodePopover').offset(offset);
}

