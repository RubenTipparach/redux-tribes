using System.Collections;
using System.Collections.Generic;
using Shapes;
using UnityEngine;
using UnityEngine.EventSystems;

[RequireComponent(typeof(WeaponButtonTemplate))]
public class WeaponInfoOverlay : ImmediateModePanel, IPointerEnterHandler, IPointerExitHandler //ImmediateModeCanvas
{

    public Color lineColor;

    bool hoverEntered = false;

    public float radius = 5;

    public float thickness = 1;
    WeaponButtonTemplate weaponButton;
    void Start(){
        weaponButton = GetComponent<WeaponButtonTemplate>();
        
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
        // // Draw a large ring, fitting it both horizontally and vertically:
        // float radius = (Mathf.Min(rect.width, rect.height) / 2) * 0.9f;
        // Draw.Ring(Vector3.zero, Quaternion.identity, radius, thickness: 1, new Color(1, 1, 1, 0.3f));

        // // Draw a rounded border around the whole screen:
        // Draw.RectangleBorder(rect, 8f, cornerRadius: 16, Color.white);

        // // Draws all ImmediateModePanel child objects.
        // // in this case, they are health/stamina/magic bars:
        // //base.DrawPanels();

        // // Draw a crosshair in the middle
        // Draw.Disc(Vector3.zero, 4f);

        if (hoverEntered 
            //|| (
            //weaponButton.weaponController.attackInfoOrder != null 
            //&& weaponButton.weaponController.attackInfoOrder.secondSlot == (int)GameManager.Instance.selectedTime
            //&& 
            //GameManager.Instance.simulationController.SimulationState == SimulationState.Planning)
            )
        {
            var infoBoxRect = (RectTransform)GameManager.Instance.uiManagerV2.anchoredWeaponSelection;
            Vector2 a = infoBoxRect.anchoredPosition + new Vector2(0, infoBoxRect.sizeDelta.y);

            var wepPos = weaponButton.weaponController.transform.position;
            var wepPos2d = GameManager.Instance.uiManagerV2.GetScreenPosition(wepPos, 0);
            var directionNormal = (wepPos2d - a).normalized;
            Draw.Ring(wepPos2d, Quaternion.identity, radius, thickness, lineColor);
            Draw.Line(a, wepPos2d - directionNormal*radius, thickness, LineEndCap.Round, lineColor);
        }
        // for (int i = 0; i < 4; i++)
        // {
        //     Draw.Line(a, b, 4f, LineEndCap.Round);
        //     a = ShapesMath.Rotate90CCW(a);
        //     b = ShapesMath.Rotate90CCW(b);
        // }
    }
}
