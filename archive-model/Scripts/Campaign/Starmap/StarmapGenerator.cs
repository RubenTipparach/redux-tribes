using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using UnityEngine.EventSystems;
using TMPro;

[ExecuteAlways]
[RequireComponent(typeof(UILineRenderer))]
public class StarmapGenerator : MonoBehaviour,
 IPointerEnterHandler, IPointerExitHandler,
 IPointerDownHandler,
 IPointerUpHandler
{

    public StarMap starMap;
    public UILineRenderer uiLineRenderer;
    // Start is called before the first frame update

    public float lineOffset = 5f;

    public RectTransform starmapMover;

    public bool clicked = false;
    //public Vector2 mousePosition;
    public Vector2 lastMousePositionClicked;
    public Vector2 currentLocation;// = transform.position;

    public Vector2 maxBounds = Vector2.one;

    public StarItemUI selectedStar;

    public StarConnections selectedLine;
    public Color traversalColor;
    public Color possibleTravel;

    public PlanetTypeDB planetDB;

    public TextMeshProUGUI starName_Label;

    public Gradient factionGradient;

    public StarItemUI[] stars;

    public void SelectStar(StarItemUI star)
    {

        if(selectedStar != null && selectedStar == star)
        {
            return;
        }

        selectedStar?.Deselect();
        selectedStar = star;
        
        var connectedStars = starMap.starConnections.Where(p =>
            ( selectedStar.rectTransform == p.starB) ||
            ( selectedStar.rectTransform == p.starA)
        ).Select(p => {
            if(selectedStar.rectTransform == p.starA)
            {
                return p.starB;
            }
            else{
                return p.starA;
            }
        });

        selectedStar.SetAdjacentStars(connectedStars);

        // populate my solar system!
        // CampaignMenu.Instance.navigationPanel.solarSystem.AddPlanets(selectedStar.solarSystem, star.controllingFaction.shipFaction);

        CheckCanGoToStar();

        starName_Label.text = star.gameObject.name;
        // to do save reference to current star selected?
        // CampaignMenu.Instance.navigationPanel.solarSystem.ClearPlanetSelection();
        // todo set star type/color below!
    }




    public void CheckCanGoToStar()
    {
        // var shipStar = CampaignMenu.Instance.navigationPanel.starmapShip;
        // if(shipStar.traveling){
        //     CampaignMenu.Instance.navigationPanel.travelButton.interactable = false;
        //     return;
        // }

        // var canWeGo = starMap.starConnections.Find(p =>
        //     (shipStar.selectedStar.rectTransform == p.starA && selectedStar.rectTransform == p.starB) ||
        //     (shipStar.selectedStar.rectTransform == p.starB && selectedStar.rectTransform == p.starA)
        // );

        // Debug.Log($"check star {shipStar.selectedStar.gameObject.name} {selectedStar.gameObject.name} {canWeGo != null}");

        // if(canWeGo != null)
        // {
        //     CampaignMenu.Instance.navigationPanel.travelButton.interactable = true;
        // }else{
        //     CampaignMenu.Instance.navigationPanel.travelButton.interactable = false;
        // }
        
    }

    public void OnPointerEnter(PointerEventData eventData)
    {
    }

    public void OnPointerExit(PointerEventData eventData)
    {
    }

    public void OnPointerDown(PointerEventData eventData)
    {
        clicked = true;
        lastMousePositionClicked = Input.mousePosition;
        currentLocation = starmapMover.position;
    }

    public void OnPointerUp(PointerEventData eventData)
    {
        clicked = false;
    }

    void Start()
    {
        starName_Label.text = "";
        stars = GetComponentsInChildren<StarItemUI>();

        if (CampaignMenu.Instance != null && CampaignMenu.Instance.factionRepState != null)
        {
            foreach (var star in stars)
            {
                var factionStatus = CampaignMenu.Instance.factionRepState;
                var factionScore = factionStatus[star.controllingFaction.shipFaction].factionScore / 100f;
                var factionRepColor = factionGradient.Evaluate((factionScore + 1) / 2f);
                star.SetStarAllegiance(factionRepColor
                );
            }
        }
    }

    public void SetSelectedLine(RectTransform starA, RectTransform starB)
    {
        var foundStarPair = starMap.starConnections.Find(p =>
            (p.starA == starA && p.starB == starB) || (p.starA == starB && p.starB == starA));
        selectedLine = foundStarPair;
        foundStarPair.color = traversalColor;
        //Debug.Log($"highlight line: {starA.gameObject.name} {starB.gameObject.name} {foundStarPair.color}");
    }


    public void ClearSelection()
    {
        selectedLine.color = null;
        selectedLine = null;

        foreach(var star in starMap.starConnections)
        {
            star.color = null;
        }
    }

    public void SetHighlightStars(RectTransform currentStar){
        var canWeGo = starMap.starConnections.Where(p =>
            (currentStar == p.starB) ||
            (currentStar == p.starA)
        );
        foreach(var pair in canWeGo)
        {
            pair.color = possibleTravel;
        }
    }

    // Update is called once per frame
    void Update()
    {
        //starmapRenderer.SetPoints((Vector2)starmapRenderer.star0.position, (Vector2)starmapRenderer.star1.position);
        if (starMap != null && starMap.starConnections != null)
        {
            // starmapRenderer.SetPoints(starMap.starConnections.Where(
            //     p => p.starA != null && p.starB != null
            // ).ToArray());
            uiLineRenderer.SetPoints(
                starMap.starConnections.Where(
                p => p.starA != null && p.starB != null
                ).Select(p =>
                {
                    var direction = (p.starA.position - p.starB.position).normalized * lineOffset;
                    return new PointPair(p.starA.position - direction, p.starB.position + direction, p.color);
                }).ToList()
            );
        }

        if (clicked)
        {
            var mouseDelta = (Vector2)Input.mousePosition - lastMousePositionClicked;
            var currentPosition = currentLocation + mouseDelta;
            currentPosition.x = Mathf.Clamp(currentPosition.x, -maxBounds.x, maxBounds.x);
            currentPosition.y = Mathf.Clamp(currentPosition.y, -maxBounds.y, maxBounds.y);
            starmapMover.position = currentPosition;
            //Debug.Log("current map postiion " + starmapMover.position.ToString("0.00"));
        }
    }


}


[Serializable]
public class StarMap {
    public List<StarConnections> starConnections;
}

[Serializable]
public class StarConnections {
    public RectTransform starA;
    public RectTransform starB;
    public Color? color;
    //public bool hasColor = false;
}