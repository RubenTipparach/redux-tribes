using System.Collections;
using System.Collections.Generic;
using Shapes;
using UnityEngine;
using UnityEngine.EventSystems;

[RequireComponent(typeof(SubsystemButton))]
public class SubsystemInfoOverlay : ImmediateModePanel,
    IPointerEnterHandler,
    IPointerExitHandler //ImmediateModeCanvas
{
    // TODO need to determine where this subsystem is originated from.

    public Color lineColor;

    bool hoverEntered = false;

    public float radius = 5;

    public float thickness = 1;
    SubsystemButton subsystemButton;
    void Start(){
        subsystemButton = GetComponent<SubsystemButton>();
        
    }


    public void OnPointerEnter(PointerEventData eventData)
    {
        hoverEntered = true;
    }

    public void OnPointerExit(PointerEventData eventData)
    {
        hoverEntered = false;
    }

    public override void DrawPanelShapes(Rect rect)
    {
        if (hoverEntered || subsystemButton.IsSelected)
        {
            var infoBoxRect =  
                subsystemButton.IsPlayer ? 
                    (RectTransform)GameManager.Instance.uiManagerV2.anchoredPlayerSubsystemSelection
                    :
                    (RectTransform)GameManager.Instance.uiManagerV2.anchoredTargetSubsystemSelection;
            //var infoBoxRect = (RectTransform)GameManager.Instance.uiManagerV2.anchoredPlayerSubsystemSelection;
            
            Vector2 a = infoBoxRect.anchoredPosition;

            var subPos = subsystemButton.subsystem == null ? subsystemButton.ship.transform.position : subsystemButton.subsystem.targetLocation.position;
            var pos2D = GameManager.Instance.uiManagerV2.GetScreenPosition(subPos, 0);
            var directionNormal = (pos2D - a).normalized;
            if(!subsystemButton.IsPlayer && subsystemButton.subsystem == null)
            {
                return;// this is probably enemy hull system
            }
            Draw.Ring(pos2D, Quaternion.identity, radius, thickness, lineColor);
            Draw.Line(a, pos2D - directionNormal*radius, thickness, LineEndCap.Round, lineColor);
        }
    }
}
