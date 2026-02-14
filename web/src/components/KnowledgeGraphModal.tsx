import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface Node {
  id: string;
  type: string;
  name: string;
  properties: any;
  created_at: number;
  updated_at: number;
}

interface Edge {
  id: string;
  source: string;
  target: string;
  relationship: string;
  strength: number;
  properties?: any;
}

interface KnowledgeGraphData {
  nodes: Node[];
  edges: Edge[];
}

interface KnowledgeGraphModalProps {
  isOpen: boolean;
  onClose: () => void;
  graphData: KnowledgeGraphData | null;
  onRefresh: () => void;
}

const KnowledgeGraphModal: React.FC<KnowledgeGraphModalProps> = ({
  isOpen,
  onClose,
  graphData,
  onRefresh
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [tooltip, setTooltip] = useState<{x: number, y: number, node: Node} | null>(null);

  useEffect(() => {
    if (!isOpen || !graphData || !svgRef.current) return;

    // Clear previous visualization
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current);
    const width = 800;
    const height = 600;

    svg.attr("width", width).attr("height", height);

    // Create container group for zoom
    const container = svg.append("g");

    // Color scheme for different node types
    const colorScale = d3.scaleOrdinal<string>()
      .domain(['task', 'file', 'person', 'concept', 'component'])
      .range(['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444']);

    // Size scale based on node connections
    const sizeScale = d3.scaleLinear()
      .domain([0, 10])
      .range([8, 25]);

    // Prepare data for D3
    const nodes = graphData.nodes.map(d => ({
      ...d,
      connectionCount: graphData.edges.filter(e => e.source === d.id || e.target === d.id).length
    }));

    const links = graphData.edges.map(d => ({ ...d }));

    // Create force simulation
    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius((d: any) => sizeScale(d.connectionCount) + 5));

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        container.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Create links
    const link = container.append("g")
      .selectAll("line")
      .data(links)
      .enter().append("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-width", (d: any) => Math.sqrt(d.strength * 3))
      .attr("stroke-opacity", 0.6)
      .attr("marker-end", "url(#arrowhead)");

    // Add arrow markers
    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("xoverflow", "visible")
      .append("path")
      .attr("d", "M 0,-5 L 10 ,0 L 0,5")
      .attr("fill", "#94a3b8")
      .style("stroke", "none");

    // Create nodes
    const node = container.append("g")
      .selectAll("g")
      .data(nodes)
      .enter().append("g")
      .attr("class", "node")
      .style("cursor", "pointer")
      .call(d3.drag<SVGGElement, any>()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    // Add circles for nodes
    node.append("circle")
      .attr("r", (d: any) => sizeScale(d.connectionCount))
      .attr("fill", (d: any) => colorScale(d.type))
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 2)
      .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.1))")
      .style("transition", "all 0.2s ease")
      .on("click", (event, d: any) => {
        setSelectedNode(d);
        event.stopPropagation();
      })
      .on("mouseover", (event, d: any) => {
        // Highlight the node
        d3.select(event.target)
          .attr("stroke-width", 3)
          .attr("stroke", "#2563eb")
          .style("filter", "drop-shadow(0 4px 8px rgba(0,0,0,0.2))");
        
        // Show tooltip
        const rect = event.target.getBoundingClientRect();
        const containerRect = svgRef.current?.getBoundingClientRect();
        if (containerRect) {
          setTooltip({
            x: rect.left - containerRect.left + rect.width / 2,
            y: rect.top - containerRect.top - 10,
            node: d
          });
        }
      })
      .on("mouseout", (event, d: any) => {
        // Reset node appearance
        d3.select(event.target)
          .attr("stroke-width", 2)
          .attr("stroke", "#ffffff")
          .style("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.1))");
        
        // Hide tooltip
        setTooltip(null);
      });

    // Add labels with better positioning
    node.append("text")
      .text((d: any) => {
        // Shorter labels for cleaner look
        const maxLength = 12;
        return d.name.length > maxLength ? d.name.substring(0, maxLength) + "..." : d.name;
      })
      .attr("text-anchor", "middle")
      .attr("dy", (d: any) => sizeScale(d.connectionCount) + 16) // Position below the circle
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("fill", "#374151")
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 2px rgba(255,255,255,0.8)"); // Better readability

    // Add relationship labels on links (more subtle)
    const linkLabels = container.append("g")
      .selectAll("text")
      .data(links)
      .enter().append("text")
      .attr("font-size", "9px")
      .attr("fill", "#9ca3af")
      .attr("text-anchor", "middle")
      .attr("font-weight", "500")
      .style("pointer-events", "none")
      .style("text-shadow", "0 1px 2px rgba(255,255,255,0.9)")
      .text((d: any) => {
        // Show shorter relationship names
        const relationMap: {[key: string]: string} = {
          'responsible_for': 'owns',
          'assigned_to': 'assigned',
          'encompasses': 'contains',
          'blocks': 'blocks',
          'creates': 'creates'
        };
        return relationMap[d.relationship] || d.relationship;
      });

    // Update positions on simulation tick
    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);

      linkLabels
        .attr("x", (d: any) => (d.source.x + d.target.x) / 2)
        .attr("y", (d: any) => (d.source.y + d.target.y) / 2);
    });

    // Drag functions
    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    // Add cleaner legend with background
    const legend = svg.append("g")
      .attr("transform", "translate(20, 20)");

    // Add background for legend
    const legendData = [
      { type: 'task', label: 'Tasks', color: colorScale('task') },
      { type: 'file', label: 'Files', color: colorScale('file') },
      { type: 'person', label: 'People', color: colorScale('person') },
      { type: 'team', label: 'Teams', color: colorScale('team') },
      { type: 'component', label: 'Components', color: colorScale('component') }
    ].filter(item => nodes.some((n: any) => n.type === item.type)); // Only show types that exist

    legend.append("rect")
      .attr("x", -10)
      .attr("y", -15)
      .attr("width", 120)
      .attr("height", legendData.length * 22 + 10)
      .attr("fill", "rgba(255, 255, 255, 0.95)")
      .attr("stroke", "#e5e7eb")
      .attr("stroke-width", 1)
      .attr("rx", 6);

    const legendItems = legend.selectAll("g.legend-item")
      .data(legendData)
      .enter().append("g")
      .attr("class", "legend-item")
      .attr("transform", (d, i) => `translate(0, ${i * 22})`);

    legendItems.append("circle")
      .attr("r", 6)
      .attr("fill", d => d.color)
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1);

    legendItems.append("text")
      .attr("x", 15)
      .attr("y", 0)
      .attr("dy", "0.35em")
      .attr("font-size", "11px")
      .attr("font-weight", "500")
      .attr("fill", "#374151")
      .text(d => d.label);

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [isOpen, graphData]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Knowledge Graph</h2>
            <p className="text-sm text-gray-500 mt-1">
              Visual representation of tasks, files, and relationships in your organization
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onRefresh}
              className="px-3 py-2 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Graph visualization */}
          <div className="flex-1 p-4 relative">
            <div className="bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 h-full flex items-center justify-center">
              {graphData && graphData.nodes.length > 0 ? (
                <svg ref={svgRef} className="w-full h-full"></svg>
              ) : (
                <div className="text-center text-gray-500">
                  <div className="text-4xl mb-4">🕸️</div>
                  <p className="text-lg mb-2">No knowledge graph data</p>
                  <p className="text-sm">Generate a plan or complete tasks to build the knowledge graph</p>
                </div>
              )}
            </div>
            
            {/* Tooltip */}
            {tooltip && (
              <div 
                className="absolute z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg pointer-events-none"
                style={{
                  left: tooltip.x,
                  top: tooltip.y,
                  transform: 'translate(-50%, -100%)'
                }}
              >
                <div className="font-semibold">{tooltip.node.name}</div>
                <div className="text-gray-300 capitalize">{tooltip.node.type}</div>
                {tooltip.node.properties?.description && (
                  <div className="text-gray-300 mt-1 max-w-xs">
                    {tooltip.node.properties.description.length > 100 
                      ? tooltip.node.properties.description.substring(0, 100) + "..."
                      : tooltip.node.properties.description
                    }
                  </div>
                )}
                {tooltip.node.properties?.priority && (
                  <div className="text-gray-300 mt-1">
                    Priority: {tooltip.node.properties.priority}
                  </div>
                )}
                {tooltip.node.properties?.status && (
                  <div className="text-gray-300 mt-1">
                    Status: {tooltip.node.properties.status}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Node details panel */}
          {selectedNode && (
            <div className="w-80 border-l bg-gray-50 p-4 overflow-y-auto">
              <h3 className="font-semibold text-gray-900 mb-3">Node Details</h3>
              
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Name</label>
                  <p className="text-sm text-gray-900 mt-1">{selectedNode.name}</p>
                </div>
                
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Type</label>
                  <span className="inline-block mt-1 px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                    {selectedNode.type}
                  </span>
                </div>
                
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Created</label>
                  <p className="text-sm text-gray-900 mt-1">
                    {new Date(selectedNode.created_at * 1000).toLocaleDateString()}
                  </p>
                </div>

                {selectedNode.properties && Object.keys(selectedNode.properties).length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Properties</label>
                    <div className="mt-1 space-y-2">
                      {Object.entries(selectedNode.properties).map(([key, value]) => (
                        <div key={key} className="text-xs">
                          <span className="font-medium text-gray-700">{key}:</span>
                          <span className="ml-1 text-gray-600">
                            {typeof value === 'string' ? value : JSON.stringify(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setSelectedNode(null)}
                className="mt-4 w-full px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Close Details
              </button>
            </div>
          )}
        </div>

        {/* Stats footer */}
        {graphData && (
          <div className="border-t p-4 bg-gray-50 flex items-center justify-between text-sm text-gray-600">
            <div className="flex items-center gap-4">
              <span>{graphData.nodes.length} nodes</span>
              <span>{graphData.edges.length} connections</span>
            </div>
            <div className="text-xs text-gray-500">
              Drag nodes • Click to inspect • Scroll to zoom
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KnowledgeGraphModal;